import { createClient } from '@supabase/supabase-js'
import { openAITokenLimit, postOpenAIChat } from './openai-chat'
import { FlowImage, FlowNode, FlowEdge, AIProvider, AgentMemoryBlock, HistoryTurn, AISession, SwitchCase, FlowNodeData, FlowReplyButton } from '@/types'
import { decrypt } from './ai-crypto'
import { getCountryForInstance, getFulfillmentClient, refreshFulfillmentOrder } from './fulfillment-service'
import { SANDBOX_INSTANCE_NAME } from './sandbox'
import {
  dispatchClearTypingIndicator,
  dispatchSendButtons,
  dispatchSendImage,
  dispatchSendTemplate,
  dispatchSendText,
  dispatchSendTypingIndicator,
  supportsNativeButtons,
} from './whatsapp-dispatch'
import { getAccountProvider } from './whatsapp-account-provider'
import { loadWhatsAppTemplateById } from './whatsapp-templates'
import { getTemplateQuickReplyButtons } from './whatsapp-template-buttons'
import { isWithinMessagingWindow, OutsideMessagingWindowError } from './messaging-window'
import {
  buildMessageTemplateValues,
  formatTextReplyMessage,
  getMessagePlaceholders,
  renderMessageContent,
  renderMessageTemplate,
  type RenderedMessageContent,
} from './message-template'
import { OrderContextPendingError, resolveFlowOrder, resolveMessageTemplateContext } from './message-context'
import { enqueueFlowMessageResumeJob } from './flow-jobs'
import { updateFulfillmentOrderState } from './fulfillment-order-state'
import { isOrderStateField, isOrderStateValue } from './order-state'
import { recordOutboundMessage } from './outbound-message'
import { createLogger, isLogLevelEnabled } from './logger'
import {
  FORWARDABLE_NOTIFICATION_COLUMNS,
  forwardNotificationToSlack,
  postSlackHandoff,
  type ForwardableNotification,
} from './slack-notifications'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface FlowContext {
  instanceName: string
  remoteJid: string
  conversationId: string
  incomingMessage: string
  orderId?: string
  // Checkout abandonado que originou o fluxo (gatilho "Carrinho abandonado")
  // — alimenta as variáveis {{carrinho.*}}.
  checkoutId?: string
  flowRunId?: string
  jobId?: string
  // True when this conversation belongs to the sandbox test account.
  // Real Evolution/WhatsApp sends and real FenixCOD stock lookups are
  // intercepted for sandbox conversations; everything else (AI calls,
  // node traversal, order creation) runs for real.
  isSandbox?: boolean
  // Set only for sandbox conversations tied to a contact imported from a
  // real connected account with real-send explicitly enabled. When set,
  // outbound WhatsApp sends for this conversation go out for real through
  // this instance instead of being intercepted.
  realSendInstanceName?: string
  // Id (wamid) da mensagem do cliente que disparou esta execução. Só a
  // Cloud API usa: o "digitando…" dela é atrelado a uma mensagem recebida.
  inboundWaMessageId?: string
}


// ─── Logger ───────────────────────────────────────────────────────────────────

// Detalhe passo a passo (cada node, cada chamada de IA com o corpo da
// resposta, prévias de mensagens de clientes) só com LOG_LEVEL=debug — em
// produção isso era dezenas de linhas por mensagem, com conteúdo de conversa.
// Erros sempre aparecem; o resumo de cada execução sai em info (engineLog).
const engineLog = createLogger('flow-engine')

function log(tag: string, ...args: unknown[]) {
  if (!isLogLevelEnabled('debug')) return
  console.log(`[flow-engine] ${tag}`, ...args)
}

function logError(tag: string, ...args: unknown[]) {
  console.error(`[flow-engine] ${tag}`, ...args)
}

// ─── WhatsApp send ────────────────────────────────────────────────────────────

/**
 * Determina para qual instância da Evolution API (se houver) a mensagem deve
 * de fato ser enviada. A barreira fica aqui, amarrada ao instanceName em vez
 * de depender só da flag isSandbox — mesmo que algum chamador esqueça de
 * setar ctx.isSandbox, uma conversa cuja instância é literalmente
 * "__sandbox__" NUNCA envia de verdade a menos que realSendInstanceName
 * tenha sido explicitamente resolvido a partir de um contato de teste
 * importado com o envio real ligado (ver app/api/fulfillment/sandbox/message/route.ts).
 */
export function resolveRealSendTarget(ctx: FlowContext): string | undefined {
  if (ctx.instanceName === SANDBOX_INSTANCE_NAME) {
    return ctx.isSandbox ? ctx.realSendInstanceName : undefined
  }
  return ctx.instanceName
}

export interface TypingIndicator {
  // Apaga o indicador quando nenhuma resposta vai ser enviada (falha da IA,
  // resposta vazia). Enviar uma mensagem já o apaga — não precisa chamar.
  stop(): Promise<void>
}

const NO_TYPING_INDICATOR: TypingIndicator = { stop: async () => {} }

/**
 * Mostra "digitando…" ao cliente enquanto a IA gera a resposta. Dispara a
 * chamada em segundo plano (a da Evolution só retorna ao fim do indicador) e
 * nunca lança: falhar em exibir o indicador não pode impedir a resposta.
 * Respeita a mesma barreira de sandbox do envio real.
 */
export function startTypingIndicator(ctx: FlowContext): TypingIndicator {
  const target = resolveRealSendTarget(ctx)
  if (!target) return NO_TYPING_INDICATOR

  void (async () => {
    try {
      await dispatchSendTypingIndicator(target, ctx.remoteJid, { inboundMessageId: ctx.inboundWaMessageId })
    } catch (err) {
      engineLog.warn('falha ao exibir "digitando…"', { instance: target, err }, { throttleKey: `typing:${target}` })
    }
  })()

  return {
    async stop() {
      try {
        await dispatchClearTypingIndicator(target, ctx.remoteJid)
      } catch (err) {
        engineLog.warn('falha ao apagar "digitando…"', { instance: target, err }, { throttleKey: `typing-clear:${target}` })
      }
    },
  }
}

export async function sendWhatsApp(ctx: FlowContext, text: string) {
  let waMessageId: string | null = null
  const realSendTarget = resolveRealSendTarget(ctx)
  if (realSendTarget) {
    const result = await dispatchSendText(realSendTarget, ctx.remoteJid, text)
    waMessageId = result.waMessageId
  }

  await recordOutboundMessage({
    conversation_id: ctx.conversationId,
    wa_message_id: waMessageId,
    content: text,
    type: 'text',
    direction: 'outbound',
    status: 'sent',
    sender_type: 'ai',
  })

  await supabase.from('conversations').update({
    last_message: text,
    last_message_at: new Date().toISOString(),
  }).eq('id', ctx.conversationId)
}

export async function sendWhatsAppReplyOptions(
  ctx: FlowContext,
  content: RenderedMessageContent,
  options: { thumbnailUrl?: string; nativeEnabled?: boolean } = {}
): Promise<'native' | 'text'> {
  const persistedText = formatTextReplyMessage(content)
  const realSendTarget = resolveRealSendTarget(ctx)
  // Aceita um resultado já resolvido pelo chamador (o node sendMessage já
  // calcula isso para decidir se combina com a imagem como thumbnail) —
  // evita uma segunda consulta a accounts para a mesma decisão.
  const nativeEnabled = options.nativeEnabled
    ?? (realSendTarget ? await supportsNativeButtons(realSendTarget) : false)

  if (!realSendTarget || !nativeEnabled) {
    if (options.thumbnailUrl) {
      await sendWhatsAppImage(ctx, options.thumbnailUrl, persistedText)
    } else {
      await sendWhatsApp(ctx, persistedText)
    }
    return 'text'
  }

  let result: Awaited<ReturnType<typeof dispatchSendButtons>>
  try {
    result = await dispatchSendButtons(realSendTarget, ctx.remoteJid, content, options)
  } catch (error) {
    logError('sendWhatsAppReplyOptions: native send failed, using text fallback', {
      error: error instanceof Error ? error.message : error,
    })
    if (options.thumbnailUrl) {
      await sendWhatsAppImage(ctx, options.thumbnailUrl, persistedText)
    } else {
      await sendWhatsApp(ctx, persistedText)
    }
    return 'text'
  }

  await recordOutboundMessage({
    conversation_id: ctx.conversationId,
    wa_message_id: result.waMessageId,
    content: options.thumbnailUrl
      ? `${options.thumbnailUrl}\n${persistedText}`
      : persistedText,
    type: options.thumbnailUrl ? 'image' : 'text',
    direction: 'outbound',
    status: 'sent',
    sender_type: 'ai',
  })
  await supabase.from('conversations').update({
    last_message: persistedText,
    last_message_at: new Date().toISOString(),
  }).eq('id', ctx.conversationId)
  return 'native'
}

export async function sendWhatsAppImage(
  ctx: FlowContext,
  imageUrl: string,
  caption?: string
) {
  let waMessageId: string | null = null
  const normalizedCaption = caption?.trim() ?? ''
  const realSendTarget = resolveRealSendTarget(ctx)
  if (realSendTarget) {
    const result = await dispatchSendImage(realSendTarget, ctx.remoteJid, imageUrl, caption)
    waMessageId = result.waMessageId
  }

  await recordOutboundMessage({
    conversation_id: ctx.conversationId,
    wa_message_id: waMessageId,
    content: normalizedCaption ? `${imageUrl}\n${normalizedCaption}` : imageUrl,
    type: 'image',
    direction: 'outbound',
    status: 'sent',
    sender_type: 'ai',
  })

  await supabase.from('conversations').update({
    last_message: normalizedCaption || '📷 Imagem',
    last_message_at: new Date().toISOString(),
  }).eq('id', ctx.conversationId)
}

export function interpolateTemplateBody(bodyText: string, parameters: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, num: string) => {
    const index = Number.parseInt(num, 10) - 1
    return parameters[index] ?? match
  })
}

// Modo Template (Fase 4) — contorna a janela de 24h enviando um template já
// aprovado pela Meta em vez de texto livre. templateVariableMap mapeia cada
// posição numerada ("1","2",...) do template para um valor que pode conter
// {{variavel}} do FlashFlow ou ser texto literal — reaproveita 100% do motor
// de variáveis já existente (message-template.ts), só trocando o alvo do
// placeholder (numerado em vez de nomeado).
//
// replyButtons (opcional): os botões de resposta do node. Se o template tem
// botões de resposta rápida, cada um recebe como payload o id do botão do
// node na mesma posição — é esse id que volta no webhook quando o cliente
// toca, e que o fluxo usa para saber qual opção foi escolhida (mesmo que o
// texto do botão do template seja diferente do label no fluxo).
export async function sendWhatsAppTemplate(
  ctx: FlowContext,
  templateId: string,
  variableMap: Record<string, string>,
  replyButtons: FlowReplyButton[] = []
): Promise<void> {
  const template = await loadWhatsAppTemplateById(templateId)
  if (!template) throw new Error(`Template "${templateId}" não encontrado`)
  const quickReplyPayloads = getTemplateQuickReplyButtons(template.buttons).map((button, position) => ({
    index: button.index,
    payload: replyButtons[position]?.id ?? button.text,
  }))

  const rawValues = Array.from({ length: template.variable_count }, (_, i) => variableMap[String(i + 1)] ?? '')
  const hasVariables = getMessagePlaceholders(...rawValues).length > 0
  const templateContext = hasVariables
    ? await resolveMessageTemplateContext({
      instanceName: ctx.instanceName,
      conversationId: ctx.conversationId,
      remoteJid: ctx.remoteJid,
      orderId: ctx.orderId,
      checkoutId: ctx.checkoutId,
      templates: rawValues,
    })
    : { contact: { name: null, number: ctx.remoteJid }, customVariables: {} }
  const values = buildMessageTemplateValues(templateContext)
  const parameters = rawValues.map((raw) => renderMessageTemplate(raw, values))
  const renderedBody = interpolateTemplateBody(template.body_text, parameters)

  let waMessageId: string | null = null
  const realSendTarget = resolveRealSendTarget(ctx)
  if (realSendTarget) {
    const sendArgs = [realSendTarget, ctx.remoteJid, template.meta_template_name, template.language, parameters] as const
    const result = quickReplyPayloads.length > 0
      ? await dispatchSendTemplate(...sendArgs, { quickReplyPayloads })
      : await dispatchSendTemplate(...sendArgs)
    waMessageId = result.waMessageId
  }

  await recordOutboundMessage({
    conversation_id: ctx.conversationId,
    wa_message_id: waMessageId,
    content: renderedBody,
    type: 'text',
    direction: 'outbound',
    status: 'sent',
    sender_type: 'ai',
  })
  await supabase.from('conversations').update({
    last_message: renderedBody,
    last_message_at: new Date().toISOString(),
  }).eq('id', ctx.conversationId)
}

// Pausa o fluxo até o cliente responder: a próxima mensagem recebida retoma
// a execução em resumeAt (ver webhook → checkActiveFlowRun). replyButtons
// alimenta normalizeReplyInput para traduzir o toque num botão (ou o texto
// digitado) no label que os nós seguintes esperam.
async function pauseFlowForReply(
  ctx: FlowContext,
  flowId: string,
  resumeAt: string,
  replyButtons: FlowReplyButton[]
): Promise<void> {
  const { error } = await supabase.from('flow_runs').upsert({
    instance_name: ctx.instanceName,
    remote_jid: ctx.remoteJid,
    conversation_id: ctx.conversationId,
    flow_id: flowId,
    node_id: resumeAt,
    status: 'waiting_confirmation',
    variables: {
      orderId: ctx.orderId ?? null,
      checkoutId: ctx.checkoutId ?? null,
      replyButtons,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'instance_name,remote_jid' })
  if (error) throw new Error(`Falha ao pausar fluxo: ${error.message}`)
}

// ─── Memory injection ─────────────────────────────────────────────────────────

async function buildMemoryPrompt(blockIds: string[], userMessage: string): Promise<string> {
  if (!blockIds.length) return ''

  const { data: blocks } = await supabase
    .from('agent_memory_blocks')
    .select('*')
    .in('id', blockIds)

  if (!blocks?.length) return ''

  const msg = userMessage.toLowerCase()

  const selected = (blocks as AgentMemoryBlock[]).filter((block) => {
    if (block.type === 'always') return true
    return block.keywords.some((kw) => msg.includes(kw.toLowerCase()))
  })

  if (!selected.length) return ''

  log(`buildMemoryPrompt`, { total: blocks.length, selected: selected.length })

  return '\n\n[Memória do Agente]\n' +
    selected.map((b) => `${b.name}:\n${b.content}`).join('\n\n')
}

// ─── AI call with full logging ────────────────────────────────────────────────

const ESCALATION_TOOL_NAME = 'solicitar_atendimento_humano'

const DEFAULT_ESCALATION_PROMPT = `\n\n[Instrução interna do sistema — NUNCA mencione ao cliente]: Quando você não souber responder, não tiver informações suficientes, ou o cliente solicitar falar com um humano/atendente, utilize a ferramenta '${ESCALATION_TOOL_NAME}'. Um operador será notificado.`

// Signal used as text fallback for OpenRouter models that don't support function calling
const ESCALATION_SIGNAL = '[[ATENDIMENTO_HUMANO]]'

// Dynamic fulfillment lookups the AI can call mid-conversation. Only available
// in native tool-calling mode (no text-signal fallback like escalation has —
// parsing query arguments back out of free-form text would be far less
// reliable than a plain yes/no signal).
const CONSULTAR_PRODUTOS_TOOL_NAME = 'consultar_produtos'
const CONSULTAR_ESTOQUE_TOOL_NAME = 'consultar_estoque'
const CONSULTAR_PEDIDO_TOOL_NAME = 'consultar_pedido'

const CONSULTAR_PRODUTOS_DESCRIPTION = 'Lists the products available in the catalog (name, SKU, price). Call this when the customer asks what products are sold.'
const CONSULTAR_ESTOQUE_DESCRIPTION = 'Checks real-time stock availability for a specific product. Call this when the customer asks if a product is in stock or available.'
const CONSULTAR_PEDIDO_DESCRIPTION = 'Looks up this conversation\'s current order status (commercial, shipping and delivery). Call this when the customer asks about their order or delivery.'

export type FulfillmentToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<string>

function isFulfillmentToolName(name: string | undefined): boolean {
  return name === CONSULTAR_PRODUTOS_TOOL_NAME || name === CONSULTAR_ESTOQUE_TOOL_NAME || name === CONSULTAR_PEDIDO_TOOL_NAME
}

async function callAI(
  provider: AIProvider,
  model: string,
  customModel: string | undefined,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  history: HistoryTurn[] = [],
  maxTokens?: number,
  withEscalation = false,
  withFulfillmentTools = false,
  executeTool?: FulfillmentToolExecutor
): Promise<{ reply: string; requiresHuman: boolean }> {
  const safeTemp = isNaN(temperature) ? 0.7 : temperature

  log(`callAI start`, {
    provider,
    model: model || '(default)',
    customModel: customModel || '(none)',
    systemPromptLength: systemPrompt.length,
    userMessageLength: userMessage.length,
    temperature: safeTemp,
    withEscalation,
    withFulfillmentTools,
  })

  // ── Fetch API key ──
  const { data: keyRow, error: keyError } = await supabase
    .from('ai_provider_keys')
    .select('encrypted_key, iv, auth_tag, custom_model')
    .eq('provider', provider)
    .maybeSingle()

  if (keyError) {
    logError(`callAI key fetch error`, { provider, error: keyError.message })
    throw new Error(`Erro ao buscar chave para ${provider}: ${keyError.message}`)
  }

  if (!keyRow) {
    logError(`callAI no key found`, { provider })
    throw new Error(`Nenhuma chave configurada para ${provider}`)
  }

  log(`callAI key found`, { provider, hasCustomModel: !!keyRow.custom_model })

  let apiKey: string
  try {
    apiKey = decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)
    log(`callAI key decrypted`, { provider, keyLength: apiKey.length })
  } catch (err) {
    logError(`callAI decrypt error`, { provider, error: err })
    throw new Error(`Falha ao descriptografar chave de ${provider}`)
  }

  // ── Gemini ──
  if (provider === 'gemini') {
    const actualModel = model || 'gemini-2.5-flash'
    // gemini-2.5-* are preview and only available on v1beta; 1.x and 2.0 models use the stable v1 endpoint
    const apiVersion = actualModel.startsWith('gemini-2.5') ? 'v1beta' : 'v1'
    // v1 and v1beta both accept camelCase (proto-JSON standard); snake_case only worked in v1beta
    const historyContents = history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }))
    const requestContents = [...historyContents, { role: 'user', parts: [{ text: userMessage }] }]
    const requestBody: Record<string, unknown> = {
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: requestContents,
      generationConfig: { temperature: safeTemp, ...(maxTokens ? { maxOutputTokens: maxTokens } : {}) },
    }

    const geminiFunctionDeclarations: Record<string, unknown>[] = []
    if (withEscalation) {
      geminiFunctionDeclarations.push({
        name: ESCALATION_TOOL_NAME,
        description: 'Call this function when you cannot answer the user\'s question, lack sufficient information, or the client explicitly requests to speak with a human agent.',
        parameters: {
          type: 'OBJECT',
          properties: {
            motivo: { type: 'STRING', description: 'Brief reason for escalation' },
          },
        },
      })
    }
    if (withFulfillmentTools) {
      geminiFunctionDeclarations.push(
        { name: CONSULTAR_PRODUTOS_TOOL_NAME, description: CONSULTAR_PRODUTOS_DESCRIPTION, parameters: { type: 'OBJECT', properties: {} } },
        {
          name: CONSULTAR_ESTOQUE_TOOL_NAME,
          description: CONSULTAR_ESTOQUE_DESCRIPTION,
          parameters: {
            type: 'OBJECT',
            properties: { produto: { type: 'STRING', description: 'Product name or SKU' } },
            required: ['produto'],
          },
        },
        { name: CONSULTAR_PEDIDO_TOOL_NAME, description: CONSULTAR_PEDIDO_DESCRIPTION, parameters: { type: 'OBJECT', properties: {} } },
      )
    }
    if (geminiFunctionDeclarations.length > 0) {
      requestBody.tools = [{ functionDeclarations: geminiFunctionDeclarations }]
      requestBody.tool_config = { function_calling_config: { mode: 'AUTO' } }
    }

    log(`callAI gemini request`, {
      model: actualModel,
      apiVersion,
      url: `https://generativelanguage.googleapis.com/${apiVersion}/models/${actualModel}:generateContent?key=[REDACTED]`,
      hasSystemInstruction: !!systemPrompt,
      withEscalation,
      withFulfillmentTools,
    })

    const geminiEndpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${actualModel}:generateContent?key=${apiKey}`

    const res = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    log(`callAI gemini response status`, { status: res.status, ok: res.ok })

    const data = await res.json().catch((e) => {
      logError(`callAI gemini response parse error`, { error: e })
      return {}
    })

    log(`callAI gemini response body`, JSON.stringify(data))

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      logError(`callAI gemini API error`, { status: res.status, error: msg })
      throw new Error(`Gemini API error: ${msg}`)
    }

    type GeminiPart = { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }
    const parts: GeminiPart[] = data.candidates?.[0]?.content?.parts ?? []
    const funcCallPart = parts.find((p) => p.functionCall)
    const funcName = funcCallPart?.functionCall?.name
    const requiresHuman = funcName === ESCALATION_TOOL_NAME
    let reply: string = parts.find((p) => p.text)?.text ?? ''

    let lastContents: Record<string, unknown>[] = requestContents

    if (funcName && isFulfillmentToolName(funcName) && executeTool) {
      log(`callAI gemini: fulfillment tool call`, { funcName, args: funcCallPart?.functionCall?.args })
      const toolResult = await executeTool(funcName, funcCallPart?.functionCall?.args ?? {})
      lastContents = [
        ...requestContents,
        { role: 'model', parts: [{ functionCall: { name: funcName, args: funcCallPart?.functionCall?.args ?? {} } }] },
        { role: 'function', parts: [{ functionResponse: { name: funcName, response: { content: toolResult } } }] },
      ]
      const followUpBody: Record<string, unknown> = {
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: lastContents,
        generationConfig: requestBody.generationConfig,
      }
      const followRes = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followUpBody),
      })
      const followData = await followRes.json().catch((e) => {
        logError(`callAI gemini follow-up parse error`, { error: e })
        return {}
      })
      log(`callAI gemini follow-up response`, JSON.stringify(followData))
      if (followRes.ok) {
        const followParts: GeminiPart[] = followData.candidates?.[0]?.content?.parts ?? []
        reply = followParts.find((p) => p.text)?.text ?? ''
      } else {
        logError(`callAI gemini follow-up API error`, { status: followRes.status })
      }
    }

    // Some models occasionally return a fully empty completion (no text, no tool
    // call) when several tools are offered at once, or right after a tool result.
    // One bare retry (same contents, no tools) usually resolves it instead of
    // leaving the customer without any reply.
    if (!reply.trim() && !requiresHuman) {
      log(`callAI gemini: empty reply, retrying`)
      const retryBody: Record<string, unknown> = {
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: lastContents,
        generationConfig: requestBody.generationConfig,
      }
      const retryRes = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
      })
      const retryData = await retryRes.json().catch((e) => {
        logError(`callAI gemini retry parse error`, { error: e })
        return {}
      })
      log(`callAI gemini retry response`, JSON.stringify(retryData))
      if (retryRes.ok) {
        const retryParts: GeminiPart[] = retryData.candidates?.[0]?.content?.parts ?? []
        reply = retryParts.find((p) => p.text)?.text ?? ''
      } else {
        logError(`callAI gemini retry API error`, { status: retryRes.status })
      }
    }

    log(`callAI gemini reply`, { replyLength: reply.length, requiresHuman, preview: reply.slice(0, 100) })
    if (!reply && !requiresHuman) {
      log(`callAI gemini empty reply — full response for debug`, JSON.stringify(data))
    }

    return { reply, requiresHuman }
  }

  // ── OpenAI ──
  if (provider === 'openai') {
    const actualModel = model || 'gpt-4o'
    const messages: Record<string, unknown>[] = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ]
    const requestBody: Record<string, unknown> = {
      model: actualModel,
      messages,
      temperature: safeTemp,
      ...openAITokenLimit(maxTokens),
    }

    const openaiTools: Record<string, unknown>[] = []
    if (withEscalation) {
      openaiTools.push({
        type: 'function',
        function: {
          name: ESCALATION_TOOL_NAME,
          description: 'Call this function when you cannot answer the user\'s question, lack sufficient information, or the client explicitly requests to speak with a human agent.',
          parameters: {
            type: 'object',
            properties: {
              motivo: { type: 'string', description: 'Brief reason for escalation' },
            },
          },
        },
      })
    }
    if (withFulfillmentTools) {
      openaiTools.push(
        { type: 'function', function: { name: CONSULTAR_PRODUTOS_TOOL_NAME, description: CONSULTAR_PRODUTOS_DESCRIPTION, parameters: { type: 'object', properties: {} } } },
        {
          type: 'function',
          function: {
            name: CONSULTAR_ESTOQUE_TOOL_NAME,
            description: CONSULTAR_ESTOQUE_DESCRIPTION,
            parameters: {
              type: 'object',
              properties: { produto: { type: 'string', description: 'Product name or SKU' } },
              required: ['produto'],
            },
          },
        },
        { type: 'function', function: { name: CONSULTAR_PEDIDO_TOOL_NAME, description: CONSULTAR_PEDIDO_DESCRIPTION, parameters: { type: 'object', properties: {} } } },
      )
    }
    if (openaiTools.length > 0) {
      requestBody.tools = openaiTools
      requestBody.tool_choice = 'auto'
    }

    log(`callAI openai request`, {
      model: actualModel,
      messageCount: messages.length,
      hasSystem: !!systemPrompt,
      temperature: safeTemp,
      withEscalation,
      withFulfillmentTools,
    })

    const res = await postOpenAIChat(apiKey, requestBody)
    log(`callAI openai response status`, { status: res.status, ok: res.ok })
    const data = res.data

    log(`callAI openai response body`, JSON.stringify(data))

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      logError(`callAI openai API error`, { status: res.status, error: msg })
      throw new Error(`OpenAI API error: ${msg}`)
    }

    type ToolCall = { id?: string; function?: { name?: string; arguments?: string } }
    const toolCalls: ToolCall[] = data.choices?.[0]?.message?.tool_calls ?? []
    const requiresHuman = toolCalls.some((tc) => tc.function?.name === ESCALATION_TOOL_NAME)
    const fulfillmentCall = toolCalls.find((tc) => isFulfillmentToolName(tc.function?.name))
    let reply: string = data.choices?.[0]?.message?.content ?? ''

    let lastMessages: Record<string, unknown>[] = messages

    if (fulfillmentCall && executeTool) {
      const toolName = fulfillmentCall.function?.name as string
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = fulfillmentCall.function?.arguments ? JSON.parse(fulfillmentCall.function.arguments) : {}
      } catch (e) {
        logError(`callAI openai: failed to parse tool arguments`, { toolName, error: e })
      }
      log(`callAI openai: fulfillment tool call`, { toolName, toolArgs })
      const toolResult = await executeTool(toolName, toolArgs)
      // Rebuild a minimal, spec-shaped assistant message instead of re-sending the raw
      // API response (which carries extra fields like `refusal`/`reasoning`) — some
      // providers return a degenerate empty completion when fed those back as input.
      const assistantToolCallMessage: Record<string, unknown> = {
        role: 'assistant',
        content: data.choices?.[0]?.message?.content ?? null,
        tool_calls: [{
          id: fulfillmentCall.id,
          type: 'function',
          function: { name: fulfillmentCall.function?.name, arguments: fulfillmentCall.function?.arguments ?? '{}' },
        }],
      }
      lastMessages = [
        ...messages,
        assistantToolCallMessage,
        { role: 'tool', tool_call_id: fulfillmentCall.id, content: toolResult },
      ]
      const followRes = await postOpenAIChat(apiKey, { model: actualModel, messages: lastMessages, temperature: safeTemp, ...openAITokenLimit(maxTokens) })
      const followData = followRes.data
      log(`callAI openai follow-up response`, JSON.stringify(followData))
      if (followRes.ok) {
        reply = followData.choices?.[0]?.message?.content ?? ''
      } else {
        logError(`callAI openai follow-up API error`, { status: followRes.status })
      }
    }

    // Some models occasionally return a fully empty completion (no text, no tool
    // call) when several tools are offered at once, or right after a tool result.
    // One bare retry (same messages, no tools) usually resolves it instead of
    // leaving the customer without any reply.
    if (!reply.trim() && !requiresHuman) {
      log(`callAI openai: empty reply, retrying`)
      const retryRes = await postOpenAIChat(apiKey, { model: actualModel, messages: lastMessages, temperature: safeTemp, ...openAITokenLimit(maxTokens) })
      const retryData = retryRes.data
      log(`callAI openai retry response`, JSON.stringify(retryData))
      if (retryRes.ok) {
        reply = retryData.choices?.[0]?.message?.content ?? ''
      } else {
        logError(`callAI openai retry API error`, { status: retryRes.status })
      }
    }

    log(`callAI openai reply`, { replyLength: reply.length, requiresHuman, preview: reply.slice(0, 100) })
    if (!reply && !requiresHuman) {
      log(`callAI openai empty reply — full response for debug`, JSON.stringify(data))
    }

    return { reply, requiresHuman }
  }

  // ── OpenRouter ──
  if (provider === 'openrouter') {
    const actualModel = customModel || keyRow.custom_model || 'mistral/mistral-7b-instruct'

    const openrouterHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://flashflow.app',
      'X-Title': 'FlashFlow',
    }

    const openrouterTools: Record<string, unknown>[] = []
    if (withEscalation) {
      openrouterTools.push({
        type: 'function',
        function: {
          name: ESCALATION_TOOL_NAME,
          description: 'Call this function when you cannot answer the user\'s question, lack sufficient information, or the client explicitly requests to speak with a human agent.',
          parameters: {
            type: 'object',
            properties: {
              motivo: { type: 'string', description: 'Brief reason for escalation' },
            },
          },
        },
      })
    }
    if (withFulfillmentTools) {
      openrouterTools.push(
        { type: 'function', function: { name: CONSULTAR_PRODUTOS_TOOL_NAME, description: CONSULTAR_PRODUTOS_DESCRIPTION, parameters: { type: 'object', properties: {} } } },
        {
          type: 'function',
          function: {
            name: CONSULTAR_ESTOQUE_TOOL_NAME,
            description: CONSULTAR_ESTOQUE_DESCRIPTION,
            parameters: {
              type: 'object',
              properties: { produto: { type: 'string', description: 'Product name or SKU' } },
              required: ['produto'],
            },
          },
        },
        { type: 'function', function: { name: CONSULTAR_PEDIDO_TOOL_NAME, description: CONSULTAR_PEDIDO_DESCRIPTION, parameters: { type: 'object', properties: {} } } },
      )
    }

    async function callOpenRouter(msgs: Array<Record<string, unknown>>, attempt: number, includeTools = true) {
      log(`callAI openrouter request (attempt ${attempt})`, {
        model: actualModel,
        messageCount: msgs.length,
        hasSystem: msgs[0]?.role === 'system',
        temperature: safeTemp,
        withEscalation,
        withFulfillmentTools: withFulfillmentTools && includeTools,
      })

      const body: Record<string, unknown> = {
        model: actualModel,
        messages: msgs,
        temperature: safeTemp,
        ...(maxTokens ? {
          max_tokens: maxTokens,
          // Give reasoning models a separate token budget so they don't eat into output tokens.
          // Ignored by non-reasoning models.
          reasoning: { max_tokens: Math.max(maxTokens * 4, 2048) },
        } : {}),
      }

      if (includeTools && openrouterTools.length > 0) {
        body.tools = openrouterTools
        body.tool_choice = 'auto'
      }

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: openrouterHeaders,
        body: JSON.stringify(body),
      })

      log(`callAI openrouter response status (attempt ${attempt})`, { status: res.status, ok: res.ok })

      const data = await res.json().catch((e) => {
        logError(`callAI openrouter response parse error`, { error: e })
        return {}
      })

      log(`callAI openrouter response body (attempt ${attempt})`, JSON.stringify(data))
      return { res, data }
    }

    const messagesWithSystem = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ]

    let { res, data } = await callOpenRouter(messagesWithSystem, 1)

    // Some models (e.g. Gemma) don't support system role — retry by prepending to user message
    if (!res.ok && systemPrompt) {
      const raw: string = JSON.stringify(data?.error?.metadata?.raw ?? '')
      const isSystemNotSupported =
        raw.includes('instruction is not enabled') ||
        raw.includes('system_instruction') ||
        raw.includes('systemInstruction') ||
        String(data?.error?.message ?? '').toLowerCase().includes('system')

      if (isSystemNotSupported) {
        log(`callAI openrouter: system role rejected, retrying with prompt prepended to user message`)
        const fallbackMessages = [
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: `${systemPrompt}\n\n${userMessage}` },
        ];
        ({ res, data } = await callOpenRouter(fallbackMessages, 2))
      }
    }

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      logError(`callAI openrouter API error`, { status: res.status, error: msg })
      throw new Error(`OpenRouter API error: ${msg}`)
    }

    type ToolCall = { id?: string; function?: { name?: string; arguments?: string } }
    const toolCalls: ToolCall[] = data.choices?.[0]?.message?.tool_calls ?? []
    const toolEscalation = toolCalls.some((tc) => tc.function?.name === ESCALATION_TOOL_NAME)
    const rawReply: string = data.choices?.[0]?.message?.content ?? ''
    const signalEscalation = rawReply.includes(ESCALATION_SIGNAL)
    const requiresHuman = toolEscalation || signalEscalation
    let reply = rawReply.replace(ESCALATION_SIGNAL, '').trim()

    let lastMessages: Array<Record<string, unknown>> = messagesWithSystem

    const fulfillmentCall = toolCalls.find((tc) => isFulfillmentToolName(tc.function?.name))
    if (fulfillmentCall && executeTool) {
      const toolName = fulfillmentCall.function?.name as string
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = fulfillmentCall.function?.arguments ? JSON.parse(fulfillmentCall.function.arguments) : {}
      } catch (e) {
        logError(`callAI openrouter: failed to parse tool arguments`, { toolName, error: e })
      }
      log(`callAI openrouter: fulfillment tool call`, { toolName, toolArgs })
      const toolResult = await executeTool(toolName, toolArgs)
      // Rebuild a minimal, spec-shaped assistant message instead of re-sending the raw
      // API response (which carries extra fields like `refusal`/`reasoning`) — some
      // providers return a degenerate empty completion when fed those back as input.
      const assistantToolCallMessage: Record<string, unknown> = {
        role: 'assistant',
        content: data.choices?.[0]?.message?.content ?? null,
        tool_calls: [{
          id: fulfillmentCall.id,
          type: 'function',
          function: { name: fulfillmentCall.function?.name, arguments: fulfillmentCall.function?.arguments ?? '{}' },
        }],
      }
      lastMessages = [
        ...messagesWithSystem,
        assistantToolCallMessage,
        { role: 'tool', tool_call_id: fulfillmentCall.id, content: toolResult },
      ]
      const { res: followRes, data: followData } = await callOpenRouter(lastMessages, 3, false)
      if (followRes.ok) {
        reply = String(followData.choices?.[0]?.message?.content ?? '').replace(ESCALATION_SIGNAL, '').trim()
      } else {
        logError(`callAI openrouter follow-up API error`, { status: followRes.status })
      }
    }

    // Some models occasionally return a fully empty completion (no text, no tool
    // call) when several tools are offered at once, or right after a tool result.
    // One bare retry (same messages, no tools) usually resolves it instead of
    // leaving the customer without any reply.
    if (!reply.trim() && !requiresHuman) {
      log(`callAI openrouter: empty reply, retrying`)
      const { res: retryRes, data: retryData } = await callOpenRouter(lastMessages, 4, false)
      if (retryRes.ok) {
        reply = String(retryData.choices?.[0]?.message?.content ?? '').replace(ESCALATION_SIGNAL, '').trim()
      } else {
        logError(`callAI openrouter retry API error`, { status: retryRes.status })
      }
    }

    log(`callAI openrouter reply`, { replyLength: reply.length, requiresHuman, toolEscalation, signalEscalation, preview: reply.slice(0, 100) })
    if (!reply && !requiresHuman) {
      log(`callAI openrouter empty reply — full response for debug`, JSON.stringify(data))
    }

    return { reply, requiresHuman }
  }

  throw new Error(`Provider desconhecido: ${provider}`)
}

// ─── Fulfillment tool executor for dynamic AI queries ─────────────────────────
// Reuses the exact same reads the fulfillmentStock/fulfillmentStatus flow
// nodes already perform — this only exposes them as AI-callable tools.

function buildFulfillmentToolExecutor(ctx: FlowContext): FulfillmentToolExecutor {
  return async (toolName, args) => {
    try {
      if (toolName === CONSULTAR_PRODUTOS_TOOL_NAME) {
        const country = await getCountryForInstance(ctx.instanceName)
        const { data: products, error } = await supabase
          .from('fulfillment_products')
          .select('name, sku, price')
          .eq('country', country)
        if (error) throw new Error(error.message)
        return JSON.stringify({ products: products ?? [] })
      }

      if (toolName === CONSULTAR_ESTOQUE_TOOL_NAME) {
        const produto = String(args.produto ?? '').trim()
        if (!produto) return JSON.stringify({ error: 'Nenhum produto informado' })
        const country = await getCountryForInstance(ctx.instanceName)
        const { data: product } = await supabase
          .from('fulfillment_products')
          .select('sku, name')
          .eq('country', country)
          .or(`sku.ilike.%${produto}%,name.ilike.%${produto}%`)
          .limit(1)
          .maybeSingle()
        if (!product) return JSON.stringify({ error: `Produto "${produto}" não encontrado no catálogo` })
        const stock = ctx.isSandbox
          ? { sku: product.sku, stock: 999, sandbox: true }
          : await (await getFulfillmentClient(country)).getStock(product.sku)
        return JSON.stringify({ product: product.name, stock })
      }

      if (toolName === CONSULTAR_PEDIDO_TOOL_NAME) {
        const { data: order, error } = await supabase
          .from('fulfillment_orders')
          .select('id, order_number, lead_number, status, commercial_status, send_status, delivery_status')
          .eq('conversation_id', ctx.conversationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error || !order) return JSON.stringify({ error: 'Nenhum pedido encontrado para esta conversa' })
        const updated = order.lead_number ? await refreshFulfillmentOrder(order.id) : null
        return JSON.stringify({
          orderNumber: order.order_number,
          leadNumber: order.lead_number,
          status: updated?.status ?? order.status,
          commercialStatus: order.commercial_status,
          sendStatus: order.send_status,
          deliveryStatus: updated?.delivery_status ?? order.delivery_status,
        })
      }

      return JSON.stringify({ error: `Tool desconhecida: ${toolName}` })
    } catch (error) {
      logError('fulfillmentToolExecutor', { toolName, error })
      return JSON.stringify({ error: 'Falha ao consultar dados' })
    }
  }
}

// ─── Next node helper ─────────────────────────────────────────────────────────

function nextNodeId(edges: FlowEdge[], fromId: string, handle?: string | null): string | null {
  const edge = handle
    ? edges.find((e) => e.source === fromId && e.sourceHandle === handle)
    : edges.find((e) => e.source === fromId)
  return edge?.target ?? null
}

function renderTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''))
}

// ─── Model resolution ─────────────────────────────────────────────────────────

const PROVIDER_DEFAULT_FALLBACK: Record<AIProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o-mini',
}

async function resolveNodeModel(
  provider: AIProvider,
  nodeData: FlowNodeData
): Promise<{ model: string; customModel: string | undefined; toolsSupported: boolean | null }> {
  const { data: keyRow } = await supabase
    .from('ai_provider_keys')
    .select('custom_model, tools_supported')
    .eq('provider', provider)
    .maybeSingle()

  const toolsSupported = (keyRow?.tools_supported as boolean | null) ?? null
  const useDefaultModel = (nodeData.useDefaultModel as boolean | undefined) !== false

  const stored = (keyRow?.custom_model as string | null) ?? null

  if (useDefaultModel) {
    const resolved = stored || PROVIDER_DEFAULT_FALLBACK[provider]
    return {
      model: provider === 'openrouter' ? '' : resolved,
      customModel: provider === 'openrouter' ? resolved : undefined,
      toolsSupported,
    }
  }

  return {
    model: (nodeData.model as string) || (provider !== 'openrouter' ? PROVIDER_DEFAULT_FALLBACK[provider] : ''),
    customModel: nodeData.customModel as string | undefined,
    toolsSupported,
  }
}

// ─── Session management ───────────────────────────────────────────────────────

export async function checkActiveSession(instanceName: string, remoteJid: string): Promise<AISession | null> {
  const { data } = await supabase
    .from('ai_sessions')
    .select('*')
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .maybeSingle()

  if (!data) return null

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    log(`session expired by time`, { id: data.id, remoteJid })
    await supabase.from('ai_sessions').delete().eq('id', data.id)
    return null
  }

  if (data.max_messages !== null && data.message_count >= data.max_messages) {
    log(`session expired by message count`, { id: data.id, remoteJid, count: data.message_count })
    await supabase.from('ai_sessions').delete().eq('id', data.id)
    return null
  }

  const INACTIVITY_MS = 24 * 60 * 60 * 1000 // 24 hours
  const lastMsgAt = data.last_message_at ? new Date(data.last_message_at).getTime() : 0
  if (lastMsgAt > 0 && Date.now() - lastMsgAt > INACTIVITY_MS) {
    log(`session expired by inactivity`, { id: data.id, remoteJid, idleMs: Date.now() - lastMsgAt })
    await supabase.from('ai_sessions').delete().eq('id', data.id)

    // Send inactivity message from global config if set
    const { data: aiCfg } = await supabase
      .from('instance_ai_config')
      .select('inactivity_message')
      .eq('instance_name', instanceName)
      .maybeSingle()
    const inactivityMsg = ((aiCfg?.inactivity_message as string | null) ?? '').trim()

    if (inactivityMsg) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('instance_name', instanceName)
        .eq('wa_id', remoteJid)
        .maybeSingle()
      if (conv?.id) {
        await sendWhatsApp(
          { instanceName, remoteJid, conversationId: conv.id, incomingMessage: '' },
          inactivityMsg
        )
      }
    }

    return null
  }

  log(`session active`, { id: data.id, remoteJid, messageCount: data.message_count, requiresHuman: data.requires_human ?? false })
  return data as AISession
}

export async function handleActiveSession(session: AISession, ctx: FlowContext): Promise<void> {
  const newCount = session.message_count + 1
  const delayMs = session.response_delay_ms ?? 5000

  log(`handleActiveSession`, { sessionId: session.id, newCount, delayMs, message: ctx.incomingMessage.slice(0, 80) })

  // Early exit: session already handed off to a human — don't update anything, don't schedule a timer
  if (session.requires_human) {
    log(`handleActiveSession: skipping — session already requires human`, { sessionId: session.id })
    return
  }

  // Fetch current accumulated messages to append (prevents overwrite race on rapid messages)
  const { data: currentSession } = await supabase
    .from('ai_sessions')
    .select('pending_messages')
    .eq('id', session.id)
    .maybeSingle()

  const accumulatedMessages = [
    ...((currentSession?.pending_messages as string[] | null) ?? []),
    ctx.incomingMessage,
  ]

  await supabase.from('ai_sessions')
    .update({
      message_count: newCount,
      pending_messages: accumulatedMessages,
      pending_message: ctx.incomingMessage,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  setTimeout(async () => {
    try {
      const { data: latest } = await supabase
        .from('ai_sessions')
        .select('*')
        .eq('id', session.id)
        .maybeSingle()

      if (!latest) {
        log(`handleActiveSession timer: session gone`, { sessionId: session.id })
        return
      }

      const lastMsgTime = latest.last_message_at ? new Date(latest.last_message_at).getTime() : 0
      const sinceLastMsg = Date.now() - lastMsgTime

      if (sinceLastMsg < delayMs - 500) {
        log(`handleActiveSession timer: debounce skip`, { sessionId: session.id, sinceLastMsg, delayMs })
        return
      }

      const pendingMsgs = (latest.pending_messages as string[] | undefined) ?? []
      const userMessage = pendingMsgs.length > 0
        ? pendingMsgs.join('\n')
        : (latest.pending_message ?? '')

      log(`handleActiveSession timer: proceeding`, { sessionId: session.id, sinceLastMsg, messageCount: pendingMsgs.length, userMessagePreview: userMessage.slice(0, 80) })

      const { data: flow } = await supabase
        .from('flows')
        .select('json')
        .eq('id', session.flow_id)
        .single()

      if (!flow) {
        logError(`handleActiveSession: flow not found`, { flowId: session.flow_id })
        return
      }

      const nodes: FlowNode[] = flow.json?.nodes ?? []
      const node = nodes.find((n) => n.id === session.node_id)
      if (!node) {
        logError(`handleActiveSession: node not found`, { nodeId: session.node_id })
        return
      }

      const provider: AIProvider = (node.data.provider as AIProvider) ?? 'gemini'
      const baseSystemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7
      const memoryBlockIds = (node.data.memoryBlockIds as string[] | undefined) ?? []
      const maxTokens = (node.data.maxTokens as number | undefined) || undefined

      // Resolve model and tool support from provider config
      const { model, customModel, toolsSupported } = await resolveNodeModel(provider, node.data)

      // Read historyLimit and escalation config from global config
      const { data: aiCfgRow } = await supabase
        .from('instance_ai_config')
        .select('history_limit, escalation_enabled, escalation_stop_on_obstacle, escalation_base_prompt, fulfillment_tools_enabled')
        .eq('instance_name', ctx.instanceName)
        .maybeSingle()
      const historyLimit = (aiCfgRow?.history_limit as number | null) ?? 20
      const escalationEnabled = (aiCfgRow?.escalation_enabled as boolean | null) ?? true
      const stopOnObstacle = (aiCfgRow?.escalation_stop_on_obstacle as boolean | null) ?? true
      const escalationBasePrompt = ((aiCfgRow?.escalation_base_prompt as string | null) ?? '').trim() || DEFAULT_ESCALATION_PROMPT
      const fulfillmentToolsEnabled = (aiCfgRow?.fulfillment_tools_enabled as boolean | null) ?? true

      // If session is already escalated, skip AI call — human is handling it
      if (latest.requires_human) {
        log(`handleActiveSession: session requires human, skipping AI call`, { sessionId: session.id })
        return
      }

      // Determine escalation mode based on verified tool support
      const withEscalation = escalationEnabled && toolsSupported === true
      const useTextSignal = escalationEnabled && toolsSupported !== true
      // Dynamic product/stock/order lookups — native tool-calling only, no text-signal fallback
      const withFulfillmentTools = fulfillmentToolsEnabled && toolsSupported === true

      // Trim history to the last N exchanges (each exchange = 1 user + 1 assistant turn)
      const rawHistory = (latest.history as HistoryTurn[] | undefined) ?? []
      const history = rawHistory.slice(-(historyLimit * 2))

      const memoryChunk = await buildMemoryPrompt(memoryBlockIds, userMessage)
      let systemPrompt = memoryChunk ? baseSystemPrompt + memoryChunk : baseSystemPrompt

      // Inject escalation instruction for all providers when using text signal mode
      if (useTextSignal) {
        systemPrompt += escalationBasePrompt
      }

      log(`handleActiveSession: escalation mode`, { provider, withEscalation, useTextSignal, withFulfillmentTools, toolsSupported })

      // Só aqui, depois do debounce: durante a espera o cliente ainda pode
      // estar mandando mensagens e a IA ainda não começou a responder.
      const typing = startTypingIndicator(ctx)
      const { reply: rawReply, requiresHuman: toolRequiresHuman } = await callAI(
        provider, model, customModel, systemPrompt, userMessage, temperature, history, maxTokens,
        withEscalation, withFulfillmentTools, withFulfillmentTools ? buildFulfillmentToolExecutor(ctx) : undefined
      ).catch(async (err: unknown) => {
        await typing.stop()
        throw err
      })

      // In text signal mode, detect and strip the signal manually (callAI only strips it for OpenRouter)
      let requiresHuman = toolRequiresHuman
      let reply = rawReply
      if (useTextSignal && rawReply.includes(ESCALATION_SIGNAL)) {
        requiresHuman = true
        reply = rawReply.replace(ESCALATION_SIGNAL, '').trim()
      }

      // A chamada de IA acima pode levar vários segundos. Reconfirma
      // requires_human agora, no último instante antes de qualquer efeito
      // externo — um operador humano (ou outro timer de debounce concorrente)
      // pode ter assumido a conversa enquanto a IA respondia. Sem isso, a
      // resposta da IA seria enviada por cima de um atendimento já escalado.
      const { data: recheck } = await supabase
        .from('ai_sessions')
        .select('requires_human')
        .eq('id', session.id)
        .maybeSingle()

      if (recheck?.requires_human && !requiresHuman) {
        log(`handleActiveSession: sessão foi escalada durante a chamada de IA — descartando resposta`, { sessionId: session.id })
        await typing.stop()
        return
      }

      if (requiresHuman) {
        log(`handleActiveSession: escalation triggered`, { sessionId: session.id, provider, withEscalation })
        const { error: escalationErr } = await supabase.from('ai_sessions')
          .update({ requires_human: true, pending_messages: [] })
          .eq('id', session.id)
        if (escalationErr) logError(`handleActiveSession: failed to set requires_human`, { sessionId: session.id, error: escalationErr.message })
        if (!escalationErr) {
          const { data: conversation } = await supabase
            .from('conversations')
            .select('contact_name, contact_phone')
            .eq('id', ctx.conversationId)
            .maybeSingle()
          const contact = String(
            conversation?.contact_name
            || conversation?.contact_phone
            || ctx.remoteJid.replace(/@.+$/, '')
          ).trim()
          const { data: createdNotifications, error: notificationError } = await supabase.from('notifications').upsert({
            instance_name: ctx.instanceName,
            type: 'escalation',
            title: 'Chat escalado',
            message: `${contact} precisa de atendimento humano.`,
            conversation_id: ctx.conversationId,
            flow_id: session.flow_id,
            source_key: `escalation:${session.id}`,
            metadata: { remoteJid: ctx.remoteJid, sessionId: session.id },
          }, { onConflict: 'instance_name,source_key', ignoreDuplicates: true })
            .select(FORWARDABLE_NOTIFICATION_COLUMNS)
          if (notificationError) {
            logError('handleActiveSession: failed to create escalation notification', {
              sessionId: session.id,
              error: notificationError.message,
            })
          }
          // ignoreDuplicates: só volta linha quando a notificação é nova —
          // a mesma escalação nunca é encaminhada ao Slack duas vezes.
          const createdEscalation = Array.isArray(createdNotifications) ? createdNotifications[0] : null
          if (createdEscalation) void forwardNotificationToSlack(createdEscalation as ForwardableNotification, 'ai_escalation')
        }
      }

      if (reply.trim()) {
        const updatedHistory: HistoryTurn[] = [
          ...history,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: reply },
        ]
        const { error: saveErr } = await supabase.from('ai_sessions')
          .update({ pending_messages: [], history: updatedHistory })
          .eq('id', session.id)
        if (saveErr) logError(`handleActiveSession: failed to save history`, { sessionId: session.id, error: saveErr.message })
        await sendWhatsApp(ctx, reply)
        log(`handleActiveSession: reply sent`, { replyLength: reply.length, historyTurns: updatedHistory.length })
      } else {
        log(`handleActiveSession: empty reply, not sending`)
        await typing.stop()
      }

      const expired =
        (latest.max_messages !== null && latest.message_count >= latest.max_messages) ||
        (latest.expires_at !== null && new Date(latest.expires_at) < new Date())

      if (expired) {
        log(`handleActiveSession: closing session`, { sessionId: session.id })
        const { data: flowForEnd } = await supabase.from('flows').select('json').eq('id', session.flow_id).single()
        if (flowForEnd) {
          const startNode = (flowForEnd.json?.nodes as FlowNode[] ?? []).find((n: FlowNode) => n.type === 'start')
          const endMsg = startNode?.data.sessionEndMessage as { enabled: boolean; text: string } | undefined
          if (endMsg?.enabled && endMsg.text?.trim()) {
            await sendWhatsApp(ctx, endMsg.text.trim())
            log(`handleActiveSession: session end message sent`)
          }
        }
        await supabase.from('ai_sessions').delete().eq('id', session.id)
      }
    } catch (err) {
      logError(`handleActiveSession timer error`, { sessionId: session.id, error: err })
    }
  }, delayMs)
}

// ─── Flow execution ───────────────────────────────────────────────────────────

export async function checkActiveFlowRun(instanceName: string, remoteJid: string) {
  const { data } = await supabase
    .from('flow_runs')
    .select('*')
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .in('status', ['collecting', 'waiting_confirmation'])
    .maybeSingle()
  return data
}

/**
 * Um flow pausado no Sandbox mas entregue de verdade pela instância real
 * (via `realSendInstanceName`, ver resolveRealSendTarget) grava seu
 * flow_runs com instance_name="__sandbox__" — a resposta do cliente,
 * porém, chega pelo webhook real da instância que de fato mandou a
 * mensagem, então checkActiveFlowRun(instanceName real, remoteJid) nunca
 * encontra essa linha. Esta função cobre esse caso: procura um flow_run
 * de Sandbox para esse remoteJid cuja conversa tenha envio real habilitado
 * apontando justamente para `instanceName`.
 */
export async function checkActiveSandboxFlowRunForRealInstance(instanceName: string, remoteJid: string) {
  if (instanceName === SANDBOX_INSTANCE_NAME) return null
  const { data: flowRun } = await supabase
    .from('flow_runs')
    .select('*')
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
    .eq('remote_jid', remoteJid)
    .in('status', ['collecting', 'waiting_confirmation'])
    .maybeSingle()
  if (!flowRun) return null

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, sandbox_real_send_enabled, sandbox_source_instance')
    .eq('id', flowRun.conversation_id)
    .maybeSingle()
  if (!conversation?.sandbox_real_send_enabled || conversation.sandbox_source_instance !== instanceName) {
    return null
  }
  return flowRun
}

export async function executeFlow(flowId: string, ctx: FlowContext, resumeNodeId?: string | null) {
  log(`executeFlow start`, { flowId, from: ctx.remoteJid, message: ctx.incomingMessage.slice(0, 80) })
  const startedAt = Date.now()

  const { data: flow, error } = await supabase
    .from('flows')
    .select('json, ativo, name')
    .eq('id', flowId)
    .single()

  if (error) {
    logError(`executeFlow DB error`, { flowId, error: error.message })
    return
  }

  if (!flow) {
    logError(`executeFlow: flow not found`, { flowId })
    return
  }

  if (!flow.ativo) {
    log(`executeFlow: flow is inactive, skipping`, { flowId })
    return
  }

  const nodes: FlowNode[] = flow.json?.nodes ?? []
  const edges: FlowEdge[] = flow.json?.edges ?? []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // Load global AI config for this instance (falls back to defaults if not set)
  const { data: aiCfgRow } = await supabase
    .from('instance_ai_config')
    .select('history_limit, timeout_minutes_enabled, timeout_minutes, timeout_messages_enabled, timeout_messages, response_delay_ms')
    .eq('instance_name', ctx.instanceName)
    .maybeSingle()
  const globalAiCfg = {
    historyLimit:            (aiCfgRow?.history_limit             as number | null)  ?? 20,
    timeoutMinutesEnabled:   (aiCfgRow?.timeout_minutes_enabled   as boolean | null) ?? true,
    timeoutMinutes:          (aiCfgRow?.timeout_minutes           as number | null)  ?? 360,
    timeoutMessagesEnabled:  (aiCfgRow?.timeout_messages_enabled  as boolean | null) ?? false,
    timeoutMessages:         (aiCfgRow?.timeout_messages          as number | null)  ?? 50,
    responseDelayMs:         (aiCfgRow?.response_delay_ms         as number | null)  ?? 5000,
  }

  log(`executeFlow loaded`, { flowId, nodeCount: nodes.length, edgeCount: edges.length })

  const startNode = nodes.find((n) => n.type === 'start')
  if (!startNode) {
    logError(`executeFlow: no start node`, { flowId })
    return
  }

  let activeFlowRunId = ctx.flowRunId
  let currentId: string | null = resumeNodeId ?? nextNodeId(edges, startNode.id)
  if (resumeNodeId && !nodeMap.has(resumeNodeId)) {
    logError('executeFlow: stale resume node, restarting flow', {
      flowId,
      nodeId: resumeNodeId,
    })
    if (activeFlowRunId) {
      await supabase.from('flow_runs').delete().eq('id', activeFlowRunId)
      activeFlowRunId = undefined
    }
    currentId = nextNodeId(edges, startNode.id)
  }
  const visited = new Set<string>()
  let anyMessageSent = false

  while (currentId && visited.size < 50) {
    if (visited.has(currentId)) {
      log(`executeFlow: loop detected, stopping`, { nodeId: currentId })
      break
    }
    visited.add(currentId)

    const node = nodeMap.get(currentId)
    if (!node) {
      logError(`executeFlow: node not in map`, { nodeId: currentId })
      break
    }

    log(`executeFlow node`, { type: node.type, id: node.id })

    if (node.type === 'end') {
      log(`executeFlow: reached end node`)
      break
    }

    if (node.type === 'sendMessage') {
      const templateId = typeof node.data.templateId === 'string' ? node.data.templateId : ''
      if (templateId) {
        // Fase 4: modo Template — caminho totalmente separado do texto livre
        // abaixo (não usa replyButtons/imagens do node nem pausa esperando
        // clique, um template não tem esse conceito no FlashFlow ainda).
        const variableMap = (node.data.templateVariableMap as Record<string, string> | undefined) ?? {}
        try {
          await sendWhatsAppTemplate(ctx, templateId, variableMap)
        } catch (error) {
          if (error instanceof OrderContextPendingError && !ctx.jobId) {
            await enqueueFlowMessageResumeJob({
              instanceName: ctx.instanceName,
              flowId,
              nodeId: node.id,
              conversationId: ctx.conversationId,
              remoteJid: ctx.remoteJid,
              orderId: ctx.orderId,
              checkoutId: ctx.checkoutId,
              isSandbox: ctx.isSandbox,
              realSendInstanceName: ctx.realSendInstanceName,
            })
            log('executeFlow sendMessage: waiting for local order context (template)', { nodeId: node.id })
            return
          }
          throw error
        }
        anyMessageSent = true
        currentId = nextNodeId(edges, node.id)
        continue
      }

      const messageTitle = typeof node.data.messageTitle === 'string' ? node.data.messageTitle : ''
      const msg = typeof node.data.message === 'string' ? node.data.message : ''
      const footer = typeof node.data.footer === 'string' ? node.data.footer : ''
      const replyButtons = Array.isArray(node.data.replyButtons)
        ? node.data.replyButtons as FlowReplyButton[]
        : []
      const images = (node.data.images as FlowImage[] | undefined) ?? []
      const combineImageAndMessage = node.data.combineImageAndMessage !== false
      const templates = [messageTitle, msg, footer, ...replyButtons.map((button) => button.label)]
      log(`executeFlow sendMessage`, {
        messageLength: msg.length,
        imageCount: images.length,
        replyButtonCount: replyButtons.length,
      })

      let rendered: RenderedMessageContent
      try {
        const hasVariables = getMessagePlaceholders(...templates).length > 0
        const templateContext = hasVariables
          ? await resolveMessageTemplateContext({
            instanceName: ctx.instanceName,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            templates,
          })
          : {
            contact: { name: null, number: ctx.remoteJid },
            customVariables: {},
          }
        rendered = renderMessageContent({
          title: messageTitle,
          message: msg,
          footer,
          replyButtons,
        }, templateContext)
      } catch (error) {
        if (error instanceof OrderContextPendingError && !ctx.jobId) {
          await enqueueFlowMessageResumeJob({
            instanceName: ctx.instanceName,
            flowId,
            nodeId: node.id,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            isSandbox: ctx.isSandbox,
            realSendInstanceName: ctx.realSendInstanceName,
          })
          log('executeFlow sendMessage: waiting for local order context', { nodeId: node.id })
          return
        }
        throw error
      }

      const renderedText = formatTextReplyMessage(rendered)
      const realSendTargetForButtons = resolveRealSendTarget(ctx)
      const nativeReplyOptionsEnabled = replyButtons.length > 0
        && Boolean(realSendTargetForButtons)
        && (realSendTargetForButtons ? await supportsNativeButtons(realSendTargetForButtons) : false)

      // Fora da janela de 24h, a Cloud API rejeita qualquer mensagem que não
      // seja Template — inclusive imagem. Em vez de deixar a chamada falhar
      // (ou enviar só parte do node, ex: imagem sem o texto/botões que a
      // acompanham, ou pausar o fluxo esperando clique num botão que nunca
      // chegou), o node inteiro vira uma notificação pro operador.
      const hasContentToSend = renderedText.trim().length > 0 || images.length > 0
      try {
        if (realSendTargetForButtons && hasContentToSend) {
          const provider = await getAccountProvider(realSendTargetForButtons)
          if (provider === 'cloud_api' && !(await isWithinMessagingWindow(ctx.conversationId))) {
            throw new OutsideMessagingWindowError(ctx.conversationId)
          }
        }
      } catch (error) {
        if (error instanceof OutsideMessagingWindowError) {
          // Template de fallback: o node inteiro (texto, imagens e botões) é
          // trocado pelo template aprovado. Como o resto do fluxo é texto
          // livre e a janela continua fechada, o fluxo pausa aqui e só
          // segue quando o cliente responder — o toque num botão do
          // template chega como resposta e reabre a janela.
          const fallbackTemplateId = typeof node.data.fallbackTemplateId === 'string' ? node.data.fallbackTemplateId : ''
          if (fallbackTemplateId) {
            const fallbackVariableMap = (node.data.fallbackTemplateVariableMap as Record<string, string> | undefined) ?? {}
            try {
              await sendWhatsAppTemplate(ctx, fallbackTemplateId, fallbackVariableMap, rendered.replyButtons)
            } catch (templateError) {
              if (templateError instanceof OrderContextPendingError && !ctx.jobId) {
                await enqueueFlowMessageResumeJob({
                  instanceName: ctx.instanceName,
                  flowId,
                  nodeId: node.id,
                  conversationId: ctx.conversationId,
                  remoteJid: ctx.remoteJid,
                  orderId: ctx.orderId,
                  checkoutId: ctx.checkoutId,
                  isSandbox: ctx.isSandbox,
                  realSendInstanceName: ctx.realSendInstanceName,
                })
                log('executeFlow sendMessage: waiting for local order context (fallback template)', { nodeId: node.id })
                return
              }
              throw templateError
            }
            anyMessageSent = true
            // Só pausa se ainda há o que executar depois — pausar num fluxo
            // que termina aqui deixaria uma execução "esperando" que
            // engoliria a primeira resposta do cliente em vez de deixá-la
            // seguir para gatilhos/sessão de IA.
            const resumeAfterTemplate = nextNodeId(edges, node.id)
            const resumeNode = resumeAfterTemplate ? nodeMap.get(resumeAfterTemplate) : undefined
            if (resumeAfterTemplate && resumeNode && resumeNode.type !== 'end') {
              await pauseFlowForReply(ctx, flowId, resumeAfterTemplate, rendered.replyButtons)
            }
            log('executeFlow sendMessage: outside 24h window, sent fallback template', {
              nodeId: node.id,
              resumeAt: resumeNode && resumeNode.type !== 'end' ? resumeAfterTemplate : null,
            })
            return
          }
          const { data: outsideWindowNotification } = await supabase.from('notifications').insert({
            instance_name: ctx.instanceName,
            type: 'flow',
            title: 'Fora da janela de 24h',
            message: 'Mensagem não enviada — fora da janela de atendimento da WhatsApp Cloud API. Use um template aprovado neste no.',
            conversation_id: ctx.conversationId,
            flow_id: flowId,
            flow_node_id: node.id,
            metadata: { remoteJid: ctx.remoteJid, orderId: ctx.orderId ?? null },
          }).select(FORWARDABLE_NOTIFICATION_COLUMNS).maybeSingle()
          if (outsideWindowNotification) {
            void forwardNotificationToSlack(outsideWindowNotification as ForwardableNotification, 'outside_window')
          }
          log('executeFlow sendMessage: outside 24h window, notification created instead of sending', { nodeId: node.id })
          return
        }
        throw error
      }

      const imageCaption = combineImageAndMessage
        && images.length > 0
        && renderedText.trim()
        && !nativeReplyOptionsEnabled
        ? renderedText
        : ''
      const nativeReplyThumbnail = combineImageAndMessage && nativeReplyOptionsEnabled
        ? images[0]?.url
        : undefined
      const imagesToSendSeparately = nativeReplyThumbnail ? images.slice(1) : images

      if (replyButtons.length > 0 && nativeReplyThumbnail) {
        await sendWhatsAppReplyOptions(ctx, rendered, { thumbnailUrl: nativeReplyThumbnail, nativeEnabled: nativeReplyOptionsEnabled })
      }
      for (const [index, img] of imagesToSendSeparately.entries()) {
        await sendWhatsAppImage(ctx, img.url, index === 0 ? imageCaption : undefined)
      }
      if (replyButtons.length > 0) {
        if (!imageCaption && !nativeReplyThumbnail) await sendWhatsAppReplyOptions(ctx, rendered, { nativeEnabled: nativeReplyOptionsEnabled })
      } else if (renderedText.trim() && !imageCaption) {
        await sendWhatsApp(ctx, renderedText)
      }
      if (renderedText.trim() || images.length > 0) anyMessageSent = true

      if (replyButtons.length > 0) {
        const resumeAt = nextNodeId(edges, node.id)
        if (!resumeAt) throw new Error('Mensagem com respostas nao possui proximo no')
        await pauseFlowForReply(ctx, flowId, resumeAt, rendered.replyButtons)
        log('executeFlow sendMessage: waiting for reply', { nodeId: node.id, resumeAt })
        return
      }
      currentId = nextNodeId(edges, node.id)
      continue
    }

    if (node.type === 'notify') {
      const template = typeof node.data.notificationMessage === 'string'
        ? node.data.notificationMessage.trim()
        : ''
      if (!template) throw new Error(`Notificacao sem mensagem no no ${node.id}`)

      let renderedMessage: string
      try {
        const hasVariables = getMessagePlaceholders(template).length > 0
        const templateContext = hasVariables
          ? await resolveMessageTemplateContext({
            instanceName: ctx.instanceName,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            templates: [template],
          })
          : {
            contact: { name: null, number: ctx.remoteJid },
            customVariables: {},
          }
        renderedMessage = renderMessageContent({ message: template }, templateContext).message
      } catch (error) {
        if (error instanceof OrderContextPendingError && !ctx.jobId) {
          await enqueueFlowMessageResumeJob({
            instanceName: ctx.instanceName,
            flowId,
            nodeId: node.id,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            isSandbox: ctx.isSandbox,
            realSendInstanceName: ctx.realSendInstanceName,
          })
          log('executeFlow notify: waiting for local order context', { nodeId: node.id })
          return
        }
        throw error
      }

      const { data: flowNotification, error: notificationError } = await supabase.from('notifications').insert({
        instance_name: ctx.instanceName,
        type: 'flow',
        title: 'Notificacao do fluxo',
        message: renderedMessage,
        conversation_id: ctx.conversationId,
        flow_id: flowId,
        flow_node_id: node.id,
        metadata: {
          remoteJid: ctx.remoteJid,
          orderId: ctx.orderId ?? null,
        },
      }).select(FORWARDABLE_NOTIFICATION_COLUMNS).maybeSingle()
      if (notificationError) {
        throw new Error(`Falha ao criar notificacao: ${notificationError.message}`)
      }
      if (flowNotification) void forwardNotificationToSlack(flowNotification as ForwardableNotification, 'flow_notify')
      log('executeFlow notify: notification created', { nodeId: node.id })
      currentId = nextNodeId(edges, node.id)
      continue
    }

    if (node.type === 'slackNotify') {
      const titleTemplate = typeof node.data.slackTitle === 'string' && node.data.slackTitle.trim()
        ? node.data.slackTitle.trim()
        : 'Atendimento humano solicitado'
      const messageTemplate = typeof node.data.slackMessage === 'string' ? node.data.slackMessage.trim() : ''
      if (!messageTemplate) throw new Error(`Node Slack sem mensagem no no ${node.id}`)

      let rendered: { title: string; message: string }
      try {
        const templates = [titleTemplate, messageTemplate]
        const templateContext = getMessagePlaceholders(...templates).length > 0
          ? await resolveMessageTemplateContext({
            instanceName: ctx.instanceName,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            templates,
          })
          : { contact: { name: null, number: ctx.remoteJid }, customVariables: {} }
        const content = renderMessageContent({ title: titleTemplate, message: messageTemplate }, templateContext)
        rendered = { title: content.title, message: content.message }
      } catch (error) {
        if (error instanceof OrderContextPendingError && !ctx.jobId) {
          await enqueueFlowMessageResumeJob({
            instanceName: ctx.instanceName,
            flowId,
            nodeId: node.id,
            conversationId: ctx.conversationId,
            remoteJid: ctx.remoteJid,
            orderId: ctx.orderId,
            checkoutId: ctx.checkoutId,
            isSandbox: ctx.isSandbox,
            realSendInstanceName: ctx.realSendInstanceName,
          })
          log('executeFlow slackNotify: waiting for local order context', { nodeId: node.id })
          return
        }
        throw error
      }

      const handoff = node.data.slackHandoff !== false
      const title = `${ctx.isSandbox ? '[Teste] ' : ''}${rendered.title}`.slice(0, 120)
      // A notificação interna existe sempre — é o registro no FlashFlow
      // mesmo se o Slack estiver fora do ar ou desconectado.
      const { data: handoffNotification, error: handoffNotificationError } = await supabase.from('notifications').insert({
        instance_name: ctx.instanceName,
        type: 'escalation',
        title,
        message: rendered.message.slice(0, 2000),
        conversation_id: ctx.conversationId,
        flow_id: flowId,
        flow_node_id: node.id,
        metadata: { remoteJid: ctx.remoteJid, orderId: ctx.orderId ?? null, slack: true, handoff },
      }).select('id').maybeSingle()
      if (handoffNotificationError) {
        throw new Error(`Falha ao criar notificacao: ${handoffNotificationError.message}`)
      }

      try {
        await postSlackHandoff({
          instanceName: ctx.instanceName,
          source: 'flow_node',
          title,
          message: rendered.message,
          originLabel: typeof flow.name === 'string' && flow.name ? `Fluxo "${flow.name}"` : 'Fluxo',
          conversationId: ctx.conversationId,
          notificationId: handoffNotification?.id ? String(handoffNotification.id) : null,
          channelId: typeof node.data.slackChannelId === 'string' ? node.data.slackChannelId : null,
          mention: node.data.slackMention ?? null,
        })
        log('executeFlow slackNotify: posted to Slack', { nodeId: node.id })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Falha ao enviar ao Slack'
        logError('executeFlow slackNotify: Slack post failed', { nodeId: node.id, error: reason })
        if (handoffNotification?.id) {
          await supabase.from('notifications').update({
            message: `${rendered.message}\n\n(Não foi possível avisar no Slack: ${reason})`.slice(0, 2000),
          }).eq('id', handoffNotification.id)
        }
      }

      if (handoff) {
        // Transferência para humano: a IA desta conversa (se houver) para de
        // responder e a automação termina aqui, como num node "Fim".
        await supabase.from('ai_sessions')
          .update({ requires_human: true, pending_messages: [] })
          .eq('instance_name', ctx.instanceName)
          .eq('remote_jid', ctx.remoteJid)
        log('executeFlow slackNotify: handed off to human, ending flow', { nodeId: node.id })
        break
      }
      currentId = nextNodeId(edges, node.id)
      continue
    }

    if (node.type === 'condition') {
      const condType = node.data.conditionType ?? 'contains'
      const condValue = (node.data.conditionValue ?? '').trim().toLowerCase()
      const content = ctx.incomingMessage.toLowerCase()
      const matched = condType === 'exact' ? content === condValue : content.includes(condValue)
      log(`executeFlow condition`, { condType, condValue, matched, nextHandle: matched ? 'true' : 'false' })
      currentId = nextNodeId(edges, currentId, matched ? 'true' : 'false')
      continue
    }

    if (node.type === 'switchCase') {
      const cases = (node.data.cases ?? []) as SwitchCase[]
      const content = ctx.incomingMessage.toLowerCase()
      let handle = 'default'
      for (let i = 0; i < cases.length; i++) {
        const val = (cases[i].value ?? '').trim().toLowerCase()
        const matched =
          cases[i].conditionType === 'exact' ? content === val : content.includes(val)
        if (matched) { handle = `case-${i}`; break }
      }
      log(`executeFlow switchCase`, { handle, casesCount: cases.length })
      currentId = nextNodeId(edges, currentId, handle)
      continue
    }

    if (node.type === 'captureOrderData') {
      const field = node.data.orderStateField
      const value = node.data.orderStateValue
      if (!isOrderStateField(field) || !isOrderStateValue(field, value)) {
        throw new Error(`Nó Capturar Dados inválido: ${node.id}`)
      }

      const order = await resolveFlowOrder({
        instanceName: ctx.instanceName,
        conversationId: ctx.conversationId,
        orderId: ctx.orderId,
      })
      const result = await updateFulfillmentOrderState({
        orderId: order.id,
        field,
        value,
        source: `flow:${flowId}:${node.id}`,
      })
      log('executeFlow captureOrderData', {
        nodeId: node.id,
        orderId: order.id,
        field,
        value,
        autoSubmitted: result.autoSubmit.submitted,
        autoSubmitError: result.autoSubmit.error ?? null,
      })
      currentId = nextNodeId(edges, currentId)
      continue
    }

    if (node.type === 'fulfillmentStock') {
      try {
        const productId = String(node.data.productId ?? '')
        const { data: product, error: productError } = await supabase
          .from('fulfillment_products')
          .select('sku')
          .eq('id', productId)
          .single()
        if (productError || !product) throw new Error('Produto não configurado')
        const stock = ctx.isSandbox
          ? { sku: product.sku, stock: 999, sandbox: true }
          : await (await getFulfillmentClient(await getCountryForInstance(ctx.instanceName))).getStock(product.sku)
        const message = renderTemplate(String(node.data.successMessage ?? 'Estoque disponível.'), {
          stock: JSON.stringify(stock),
        })
        await sendWhatsApp(ctx, message)
        anyMessageSent = true
      } catch (error) {
        logError('executeFlow fulfillmentStock', error)
        await sendWhatsApp(ctx, String(node.data.failureMessage ?? 'Não foi possível consultar o estoque.'))
        anyMessageSent = true
      }
      currentId = nextNodeId(edges, currentId)
      continue
    }

    if (node.type === 'fulfillmentStatus') {
      try {
        const { data: order, error: orderError } = await supabase
          .from('fulfillment_orders')
          .select('*')
          .eq('conversation_id', ctx.conversationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (orderError || !order) throw new Error('Pedido não encontrado')
        const updated = order.lead_number ? await refreshFulfillmentOrder(order.id) : order
        const message = renderTemplate(String(node.data.successMessage ?? 'Status do seu pedido: {{status}}'), {
          status: updated?.status ?? order.status,
          leadNumber: updated?.lead_number ?? order.lead_number ?? order.order_number,
        })
        await sendWhatsApp(ctx, message)
        anyMessageSent = true
      } catch (error) {
        logError('executeFlow fulfillmentStatus', error)
        await sendWhatsApp(ctx, String(node.data.failureMessage ?? 'Não encontrei um pedido para esta conversa.'))
        anyMessageSent = true
      }
      currentId = nextNodeId(edges, node.id)
      continue
    }

    if (node.type === 'aiAssistant') {
      const provider: AIProvider = (node.data.provider as AIProvider) ?? 'gemini'
      const { model, customModel } = await resolveNodeModel(provider, node.data as FlowNodeData)
      const baseSystemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7
      const continueConv = node.data.continueConversation
      const memoryBlockIds = (node.data.memoryBlockIds as string[] | undefined) ?? []
      // Use global AI config for timeout and delay
      const { timeoutMinutesEnabled, timeoutMinutes, timeoutMessagesEnabled, timeoutMessages, responseDelayMs } = globalAiCfg

      const sessionBase = () => {
        const expires_at = timeoutMinutesEnabled && timeoutMinutes
          ? new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString()
          : null
        const max_messages = timeoutMessagesEnabled && timeoutMessages ? timeoutMessages : null
        return { expires_at, max_messages }
      }

      // If a message was already sent to the user earlier in this flow execution,
      // skip the immediate AI response and open a waiting session instead.
      // continueConv=true  → session persists for multiple turns (uses configured timeout)
      // continueConv=false → session responds exactly once (max_messages: 1) then terminates
      if (anyMessageSent) {
        const { expires_at, max_messages } = sessionBase()
        log(`executeFlow aiAssistant: deferring — message already sent, opening waiting session`, { nodeId: node.id, continueConv })
        await supabase.from('ai_sessions').upsert(
          {
            instance_name: ctx.instanceName,
            remote_jid: ctx.remoteJid,
            flow_id: flowId,
            node_id: node.id,
            message_count: 0,
            response_delay_ms: responseDelayMs,
            expires_at,
            max_messages: continueConv ? max_messages : 1,
            pending_messages: [],
            pending_message: null,
            history: [],
            last_message_at: new Date().toISOString(),
          },
          { onConflict: 'instance_name, remote_jid', ignoreDuplicates: true }
        )
        currentId = nextNodeId(edges, currentId)
        continue
      }

      const maxTokens = (node.data.maxTokens as number | undefined) || undefined

      const memoryChunk = await buildMemoryPrompt(memoryBlockIds, ctx.incomingMessage)
      const systemPrompt = memoryChunk ? baseSystemPrompt + memoryChunk : baseSystemPrompt

      log(`executeFlow aiAssistant`, { provider, model, systemPromptLength: systemPrompt.length, memoryBlocks: memoryBlockIds.length, temperature, maxTokens, continueConversation: continueConv })

      let reply = ''
      const typing = startTypingIndicator(ctx)
      try {
        const result = await callAI(provider, model, customModel, systemPrompt, ctx.incomingMessage, temperature, [], maxTokens)
        reply = result.reply

        if (reply.trim()) {
          log(`executeFlow aiAssistant: sending reply`, { replyLength: reply.length })
          await sendWhatsApp(ctx, reply)
          anyMessageSent = true
        } else {
          log(`executeFlow aiAssistant: empty reply, not sending`)
          await typing.stop()
        }
      } catch (err) {
        logError(`executeFlow aiAssistant call failed`, { error: err })
        await typing.stop()
      }

      if (continueConv && reply.trim()) {
        const { expires_at, max_messages } = sessionBase()
        log(`executeFlow: opening AI session`, { nodeId: node.id, timeoutMinutes, timeoutMessages, responseDelayMs })
        await supabase.from('ai_sessions').upsert(
          {
            instance_name: ctx.instanceName,
            remote_jid: ctx.remoteJid,
            flow_id: flowId,
            node_id: node.id,
            message_count: 1,
            response_delay_ms: responseDelayMs,
            expires_at,
            max_messages,
            pending_messages: [],
            pending_message: ctx.incomingMessage,
            history: [
              { role: 'user', content: ctx.incomingMessage },
              { role: 'assistant', content: reply },
            ],
            last_message_at: new Date().toISOString(),
          },
          { onConflict: 'instance_name, remote_jid', ignoreDuplicates: true }
        )
      }

      currentId = nextNodeId(edges, currentId)
      continue
    }

    log(`executeFlow: unknown node type, advancing`, { type: node.type })
    currentId = nextNodeId(edges, currentId)
  }

  if (activeFlowRunId) {
    await supabase.from('flow_runs').delete().eq('id', activeFlowRunId)
  }
  engineLog.info('fluxo executado', {
    flowId,
    instance: ctx.instanceName,
    conversationId: ctx.conversationId,
    steps: visited.size,
    resumed: Boolean(resumeNodeId),
    ms: Date.now() - startedAt,
  })
}

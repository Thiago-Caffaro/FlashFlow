import { createClient } from '@supabase/supabase-js'
import { FlowNode, FlowEdge, AIProvider } from '@/types'
import { decrypt } from './ai-crypto'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

export interface FlowContext {
  instanceName: string
  remoteJid: string
  conversationId: string
  incomingMessage: string
}

interface AISession {
  id: string
  instance_name: string
  remote_jid: string
  flow_id: string
  node_id: string
  message_count: number
  max_messages: number | null
  expires_at: string | null
  response_delay_ms: number
  pending_message: string | null
  last_message_at: string | null
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(tag: string, ...args: unknown[]) {
  const ts = new Date().toISOString()
  console.log(`[FlowEngine][${ts}] ${tag}`, ...args)
}

function logError(tag: string, ...args: unknown[]) {
  const ts = new Date().toISOString()
  console.error(`[FlowEngine][${ts}] ❌ ${tag}`, ...args)
}

// ─── WhatsApp send ────────────────────────────────────────────────────────────

async function sendWhatsApp(ctx: FlowContext, text: string) {
  const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${ctx.instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ number: ctx.remoteJid, text }),
  })
  const evoData = await res.json().catch(() => ({}))
  const waMessageId: string | null = evoData?.key?.id ?? null

  await supabase.from('messages').insert({
    conversation_id: ctx.conversationId,
    wa_message_id: waMessageId,
    content: text,
    type: 'text',
    direction: 'outbound',
    status: 'sent',
  })

  await supabase.from('conversations').update({
    last_message: text,
    last_message_at: new Date().toISOString(),
  }).eq('id', ctx.conversationId)
}

// ─── AI call with full logging ────────────────────────────────────────────────

async function callAI(
  provider: AIProvider,
  model: string,
  customModel: string | undefined,
  systemPrompt: string,
  userMessage: string,
  temperature: number
): Promise<string> {
  const safeTemp = isNaN(temperature) ? 0.7 : temperature

  log(`callAI start`, {
    provider,
    model: model || '(default)',
    customModel: customModel || '(none)',
    systemPromptLength: systemPrompt.length,
    userMessageLength: userMessage.length,
    temperature: safeTemp,
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
    const requestBody = {
      ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: safeTemp },
    }

    log(`callAI gemini request`, {
      model: actualModel,
      apiVersion,
      url: `https://generativelanguage.googleapis.com/${apiVersion}/models/${actualModel}:generateContent?key=[REDACTED]`,
      hasSystemInstruction: !!systemPrompt,
      requestBody: { ...requestBody, system_instruction: systemPrompt ? '[present]' : undefined },
    })

    const res = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${actualModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    )

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

    const reply: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    log(`callAI gemini reply`, { replyLength: reply.length, empty: reply.length === 0, preview: reply.slice(0, 100) })

    if (!reply) {
      log(`callAI gemini empty reply — full response for debug`, JSON.stringify(data))
    }

    return reply
  }

  // ── OpenAI ──
  if (provider === 'openai') {
    const actualModel = model || 'gpt-4o'
    const messages = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userMessage },
    ]
    const requestBody = { model: actualModel, messages, temperature: safeTemp }

    log(`callAI openai request`, {
      model: actualModel,
      messageCount: messages.length,
      hasSystem: !!systemPrompt,
      temperature: safeTemp,
    })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
    })

    log(`callAI openai response status`, { status: res.status, ok: res.ok })

    const data = await res.json().catch((e) => {
      logError(`callAI openai response parse error`, { error: e })
      return {}
    })

    log(`callAI openai response body`, JSON.stringify(data))

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      logError(`callAI openai API error`, { status: res.status, error: msg })
      throw new Error(`OpenAI API error: ${msg}`)
    }

    const reply: string = data.choices?.[0]?.message?.content ?? ''
    log(`callAI openai reply`, { replyLength: reply.length, empty: reply.length === 0, preview: reply.slice(0, 100) })

    if (!reply) {
      log(`callAI openai empty reply — full response for debug`, JSON.stringify(data))
    }

    return reply
  }

  // ── OpenRouter ──
  if (provider === 'openrouter') {
    const actualModel = customModel || keyRow.custom_model || 'mistral/mistral-7b-instruct'
    const messages = [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userMessage },
    ]
    const requestBody = { model: actualModel, messages, temperature: safeTemp }

    log(`callAI openrouter request`, {
      model: actualModel,
      messageCount: messages.length,
      hasSystem: !!systemPrompt,
      temperature: safeTemp,
    })

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://flashflow.app',
        'X-Title': 'FlashFlow',
      },
      body: JSON.stringify(requestBody),
    })

    log(`callAI openrouter response status`, { status: res.status, ok: res.ok })

    const data = await res.json().catch((e) => {
      logError(`callAI openrouter response parse error`, { error: e })
      return {}
    })

    log(`callAI openrouter response body`, JSON.stringify(data))

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      logError(`callAI openrouter API error`, { status: res.status, error: msg })
      throw new Error(`OpenRouter API error: ${msg}`)
    }

    const reply: string = data.choices?.[0]?.message?.content ?? ''
    log(`callAI openrouter reply`, { replyLength: reply.length, empty: reply.length === 0, preview: reply.slice(0, 100) })

    if (!reply) {
      log(`callAI openrouter empty reply — full response for debug`, JSON.stringify(data))
    }

    return reply
  }

  throw new Error(`Provider desconhecido: ${provider}`)
}

// ─── Next node helper ─────────────────────────────────────────────────────────

function nextNodeId(edges: FlowEdge[], fromId: string, handle?: string | null): string | null {
  const edge = handle
    ? edges.find((e) => e.source === fromId && e.sourceHandle === handle)
    : edges.find((e) => e.source === fromId)
  return edge?.target ?? null
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

  log(`session active`, { id: data.id, remoteJid, messageCount: data.message_count })
  return data as AISession
}

export async function handleActiveSession(session: AISession, ctx: FlowContext): Promise<void> {
  const newCount = session.message_count + 1
  const delayMs = session.response_delay_ms ?? 5000

  log(`handleActiveSession`, { sessionId: session.id, newCount, delayMs, message: ctx.incomingMessage.slice(0, 80) })

  await supabase.from('ai_sessions')
    .update({
      message_count: newCount,
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

      log(`handleActiveSession timer: proceeding`, { sessionId: session.id, sinceLastMsg, pendingMessage: (latest.pending_message ?? '').slice(0, 80) })

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
      const model = (node.data.model as string) ?? 'gemini-2.5-flash'
      const customModel = node.data.customModel as string | undefined
      const systemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7

      const reply = await callAI(provider, model, customModel, systemPrompt, latest.pending_message ?? '', temperature)

      if (reply.trim()) {
        await sendWhatsApp(ctx, reply)
        log(`handleActiveSession: reply sent`, { replyLength: reply.length })
      } else {
        log(`handleActiveSession: empty reply, not sending`)
      }

      const expired =
        (latest.max_messages !== null && latest.message_count >= latest.max_messages) ||
        (latest.expires_at !== null && new Date(latest.expires_at) < new Date())

      if (expired) {
        log(`handleActiveSession: closing session`, { sessionId: session.id })
        await supabase.from('ai_sessions').delete().eq('id', session.id)
      }
    } catch (err) {
      logError(`handleActiveSession timer error`, { sessionId: session.id, error: err })
    }
  }, delayMs)
}

// ─── Flow execution ───────────────────────────────────────────────────────────

export async function executeFlow(flowId: string, ctx: FlowContext) {
  log(`executeFlow start`, { flowId, from: ctx.remoteJid, message: ctx.incomingMessage.slice(0, 80) })

  const { data: flow, error } = await supabase
    .from('flows')
    .select('json, ativo')
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

  log(`executeFlow loaded`, { flowId, nodeCount: nodes.length, edgeCount: edges.length })

  const startNode = nodes.find((n) => n.type === 'start')
  if (!startNode) {
    logError(`executeFlow: no start node`, { flowId })
    return
  }

  let currentId: string | null = nextNodeId(edges, startNode.id)
  const visited = new Set<string>()

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
      const msg = node.data.message ?? ''
      log(`executeFlow sendMessage`, { messageLength: msg.length, empty: !msg.trim() })
      if (msg.trim()) await sendWhatsApp(ctx, msg)
      currentId = nextNodeId(edges, currentId)
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

    if (node.type === 'aiAssistant') {
      const provider: AIProvider = (node.data.provider as AIProvider) ?? 'gemini'
      const model = (node.data.model as string) ?? 'gemini-2.5-flash'
      const customModel = node.data.customModel as string | undefined
      const systemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7
      const continueConv = node.data.continueConversation

      log(`executeFlow aiAssistant`, { provider, model, customModel, systemPromptLength: systemPrompt.length, temperature, continueConversation: continueConv })

      let reply = ''
      try {
        reply = await callAI(provider, model, customModel, systemPrompt, ctx.incomingMessage, temperature)

        if (reply.trim()) {
          log(`executeFlow aiAssistant: sending reply`, { replyLength: reply.length })
          await sendWhatsApp(ctx, reply)
        } else {
          log(`executeFlow aiAssistant: empty reply, not sending`)
        }
      } catch (err) {
        logError(`executeFlow aiAssistant call failed`, { error: err })
      }

      if (node.data.continueConversation && reply.trim()) {
        const timeoutType = node.data.timeoutType as 'minutes' | 'messages' | undefined
        const timeoutValue = node.data.timeoutValue as number | undefined
        const responseDelayMs = (node.data.responseDelayMs as number | undefined) ?? 5000

        let expires_at: string | null = null
        let max_messages: number | null = null

        if (timeoutType === 'minutes' && timeoutValue) {
          expires_at = new Date(Date.now() + timeoutValue * 60 * 1000).toISOString()
        } else if (timeoutType === 'messages' && timeoutValue) {
          max_messages = timeoutValue
        }

        log(`executeFlow: opening AI session`, { nodeId: node.id, timeoutType, timeoutValue, responseDelayMs })

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
            pending_message: ctx.incomingMessage,
            last_message_at: new Date().toISOString(),
          },
          { onConflict: 'instance_name, remote_jid' }
        )
      }

      currentId = nextNodeId(edges, currentId)
      continue
    }

    log(`executeFlow: unknown node type, advancing`, { type: node.type })
    currentId = nextNodeId(edges, currentId)
  }

  log(`executeFlow done`, { flowId, stepsExecuted: visited.size })
}

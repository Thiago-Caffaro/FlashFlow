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

async function callAI(
  provider: AIProvider,
  model: string,
  customModel: string | undefined,
  systemPrompt: string,
  userMessage: string,
  temperature: number
): Promise<string> {
  const { data: keyRow } = await supabase
    .from('ai_provider_keys')
    .select('encrypted_key, iv, auth_tag, custom_model')
    .eq('provider', provider)
    .maybeSingle()

  if (!keyRow) throw new Error(`Nenhuma chave configurada para ${provider}`)

  const apiKey = decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)

  if (provider === 'gemini') {
    const actualModel = model || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature },
      }),
    })
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }

  if (provider === 'openai') {
    const actualModel = model || 'gpt-4o'
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: actualModel,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ],
        temperature,
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }

  if (provider === 'openrouter') {
    const actualModel = customModel || keyRow.custom_model || 'mistral/mistral-7b-instruct'
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: actualModel,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ],
        temperature,
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }

  throw new Error(`Provider desconhecido: ${provider}`)
}

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

  // Expired by time
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from('ai_sessions').delete().eq('id', data.id)
    return null
  }

  // Expired by message count
  if (data.max_messages !== null && data.message_count >= data.max_messages) {
    await supabase.from('ai_sessions').delete().eq('id', data.id)
    return null
  }

  return data as AISession
}

export async function handleActiveSession(session: AISession, ctx: FlowContext): Promise<void> {
  const newCount = session.message_count + 1
  const delayMs = session.response_delay_ms ?? 5000

  // Update pending message and increment count before scheduling
  await supabase.from('ai_sessions')
    .update({
      message_count: newCount,
      pending_message: ctx.incomingMessage,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  // Debounced AI call: re-read DB right before sending to pick up any
  // newer message that arrived within the delay window
  setTimeout(async () => {
    try {
      const { data: latest } = await supabase
        .from('ai_sessions')
        .select('*')
        .eq('id', session.id)
        .maybeSingle()

      if (!latest) return

      // If a newer message arrived after this one, bail — that timer will handle it
      const lastMsgTime = latest.last_message_at ? new Date(latest.last_message_at).getTime() : 0
      if (Date.now() - lastMsgTime < delayMs - 500) return

      const { data: flow } = await supabase
        .from('flows')
        .select('json')
        .eq('id', session.flow_id)
        .single()

      if (!flow) return

      const nodes: FlowNode[] = flow.json?.nodes ?? []
      const node = nodes.find((n) => n.id === session.node_id)
      if (!node) return

      const provider: AIProvider = (node.data.provider as AIProvider) ?? 'gemini'
      const model = (node.data.model as string) ?? 'gemini-2.5-flash'
      const customModel = node.data.customModel as string | undefined
      const systemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7

      const reply = await callAI(provider, model, customModel, systemPrompt, latest.pending_message ?? '', temperature)
      if (reply.trim()) await sendWhatsApp(ctx, reply)

      // Close session if limit reached after this message
      const expired =
        (latest.max_messages !== null && latest.message_count >= latest.max_messages) ||
        (latest.expires_at !== null && new Date(latest.expires_at) < new Date())

      if (expired) {
        await supabase.from('ai_sessions').delete().eq('id', session.id)
      }
    } catch (err) {
      console.error('handleActiveSession error:', err)
    }
  }, delayMs)
}

// ─── Flow execution ───────────────────────────────────────────────────────────

export async function executeFlow(flowId: string, ctx: FlowContext) {
  const { data: flow, error } = await supabase
    .from('flows')
    .select('json, ativo')
    .eq('id', flowId)
    .single()

  if (error || !flow || !flow.ativo) {
    console.error('Flow não encontrado ou inativo:', flowId, error)
    return
  }

  const nodes: FlowNode[] = flow.json?.nodes ?? []
  const edges: FlowEdge[] = flow.json?.edges ?? []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const startNode = nodes.find((n) => n.type === 'start')
  if (!startNode) {
    console.error('Nó de início não encontrado no fluxo:', flowId)
    return
  }

  let currentId: string | null = nextNodeId(edges, startNode.id)
  const visited = new Set<string>()

  while (currentId && visited.size < 50) {
    if (visited.has(currentId)) break
    visited.add(currentId)

    const node = nodeMap.get(currentId)
    if (!node) break

    if (node.type === 'end') break

    if (node.type === 'sendMessage') {
      const msg = node.data.message ?? ''
      if (msg.trim()) await sendWhatsApp(ctx, msg)
      currentId = nextNodeId(edges, currentId)
      continue
    }

    if (node.type === 'condition') {
      const condType = node.data.conditionType ?? 'contains'
      const condValue = (node.data.conditionValue ?? '').trim().toLowerCase()
      const content = ctx.incomingMessage.toLowerCase()
      const matched = condType === 'exact' ? content === condValue : content.includes(condValue)
      currentId = nextNodeId(edges, currentId, matched ? 'true' : 'false')
      continue
    }

    if (node.type === 'aiAssistant') {
      const provider: AIProvider = (node.data.provider as AIProvider) ?? 'gemini'
      const model = (node.data.model as string) ?? 'gemini-2.5-flash'
      const customModel = node.data.customModel as string | undefined
      const systemPrompt = (node.data.systemPrompt as string) ?? ''
      const temperature = (node.data.temperature as number) ?? 0.7

      let reply = ''
      try {
        reply = await callAI(provider, model, customModel, systemPrompt, ctx.incomingMessage, temperature)
        if (reply.trim()) await sendWhatsApp(ctx, reply)
      } catch (err) {
        console.error('Erro na execução da IA:', err)
      }

      // Open a continue-conversation session if configured
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

    currentId = nextNodeId(edges, currentId)
  }
}

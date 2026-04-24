import { createClient } from '@supabase/supabase-js'
import { FlowNode, FlowEdge, AIProvider } from '@/types'
import { decrypt } from './ai-crypto'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

interface FlowContext {
  instanceName: string
  remoteJid: string
  conversationId: string
  incomingMessage: string
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
      const model = node.data.model ?? 'gemini-2.5-flash'
      const customModel = node.data.customModel
      const systemPrompt = node.data.systemPrompt ?? ''
      const temperature = node.data.temperature ?? 0.7

      try {
        const reply = await callAI(provider, model, customModel, systemPrompt, ctx.incomingMessage, temperature)
        if (reply.trim()) await sendWhatsApp(ctx, reply)
      } catch (err) {
        console.error('Erro na execução da IA:', err)
      }

      currentId = nextNodeId(edges, currentId)
      continue
    }

    // Tipo desconhecido — avança para o próximo
    currentId = nextNodeId(edges, currentId)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/ai-crypto'
import { validateAnalysisResult } from '@/lib/analysis-validation'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRIORITY_PROVIDERS = ['gemini', 'openai', 'openrouter'] as const
const ANALYSIS_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
}

const SYSTEM_PROMPT_TEMPLATE = `Você é um especialista em análise de conversas de atendimento via WhatsApp.
Analise as conversas abaixo e identifique padrões, tom de comunicação, tópicos recorrentes, objeções comuns e oportunidades de melhoria no atendimento.

Com base na análise e no objetivo fornecido pelo usuário, gere blocos de memória específicos e acionáveis para um agente de IA.

REGRAS:
- Seja específico e concreto — evite blocos genéricos ou óbvios
- type "always" = informações que o agente deve SEMPRE ter (tom, identidade, regras fixas)
- type "contextual" = informações ativadas por palavras-chave (respostas a objeções, detalhes de produto)
- keywords só são necessárias para blocos contextual; use termos que clientes provavelmente digitarão
- Gere entre 3 e 8 sugestões de blocos relevantes

OBJETIVO DO USUÁRIO: {user_goal}

RESPONDA EXCLUSIVAMENTE com JSON válido no formato:
{
  "analysis": "Texto de análise explicando os padrões encontrados (2-4 parágrafos)",
  "suggestions": [
    {
      "name": "Nome curto do bloco",
      "content": "Conteúdo completo que o agente deve memorizar",
      "type": "always",
      "keywords": []
    }
  ]
}

NÃO inclua markdown, NÃO use blocos de código, responda APENAS o JSON.`

export async function POST(req: NextRequest) {
  let body: {
    instance_name?: string
    conversation_ids?: string[]
    messages_per_contact?: number
    user_goal?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 })
  }

  const { instance_name, conversation_ids, user_goal } = body
  const messagesPerContact = Math.min(50, Math.max(1, body.messages_per_contact ?? 20))

  if (!instance_name?.trim()) {
    return NextResponse.json({ ok: false, error: 'instance_name obrigatório.' }, { status: 400 })
  }
  if (!Array.isArray(conversation_ids) || conversation_ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'Selecione ao menos uma conversa.' }, { status: 400 })
  }
  if (!user_goal?.trim()) {
    return NextResponse.json({ ok: false, error: 'Objetivo da análise obrigatório.' }, { status: 400 })
  }

  // ── Select cheapest available provider ────────────────────────────────────
  const { data: keyRows } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('provider, encrypted_key, iv, auth_tag, custom_model')

  type KeyRow = { provider: string; encrypted_key: string; iv: string; auth_tag: string; custom_model: string | null }
  const keyMap = new Map<string, KeyRow>((keyRows ?? []).map((r: KeyRow) => [r.provider, r]))

  let selectedProvider: string | null = null
  let selectedKey: string | null = null
  let selectedModel: string | null = null

  for (const provider of PRIORITY_PROVIDERS) {
    const row = keyMap.get(provider)
    if (!row) continue
    try {
      selectedKey = decrypt(row.encrypted_key, row.iv, row.auth_tag)
      selectedProvider = provider
      selectedModel = row.custom_model || ANALYSIS_MODELS[provider]
      break
    } catch {
      continue
    }
  }

  if (!selectedProvider || !selectedKey) {
    return NextResponse.json(
      { ok: false, error: 'Nenhum provedor de IA configurado. Configure uma chave na aba "Config. IA".' },
      { status: 400 }
    )
  }

  // ── Fetch conversations metadata ───────────────────────────────────────────
  // Filtra por instance_name explicitamente — sem isso, qualquer instância
  // poderia enviar conversation_ids de outra instância e a IA analisaria (e
  // devolveria o conteúdo de) conversas que não são suas.
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, contact_name, contact_phone')
    .eq('instance_name', instance_name)
    .in('id', conversation_ids)

  if (!conversations || conversations.length === 0) {
    return NextResponse.json({ ok: false, error: 'Conversas não encontradas.' }, { status: 400 })
  }

  // Se algum id não pertence à instância informada (ou não existe), a
  // consulta acima simplesmente o omite — não prosseguimos silenciosamente
  // com um subconjunto menor do que o solicitado.
  const foundIds = new Set(conversations.map((c: { id: string }) => c.id))
  const missingIds = conversation_ids.filter((id) => !foundIds.has(id))
  if (missingIds.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `${missingIds.length} conversa(s) não encontrada(s) ou não pertencem à instância informada.`,
      },
      { status: 400 }
    )
  }

  // ── Fetch messages for each conversation ──────────────────────────────────
  type MsgRow = { content: string; direction: string }
  const convMap = new Map<string, MsgRow[]>()

  await Promise.all(
    conversations.map(async (conv: { id: string; contact_name: string | null; contact_phone: string }) => {
      const { data: msgs } = await supabaseAdmin
        .from('messages')
        .select('content, direction')
        .eq('conversation_id', conv.id)
        .eq('type', 'text')
        .not('sender_type', 'in', '("ai","flow")')
        .order('created_at', { ascending: false })
        .limit(messagesPerContact)

      if (msgs && msgs.length > 0) {
        convMap.set(conv.id, [...msgs].reverse())
      }
    })
  )

  const totalMessages = [...convMap.values()].reduce((acc, msgs) => acc + msgs.length, 0)
  if (totalMessages === 0) {
    return NextResponse.json(
      { ok: false, error: 'Nenhuma mensagem de texto encontrada nas conversas selecionadas.' },
      { status: 400 }
    )
  }

  // ── Build conversation text ────────────────────────────────────────────────
  const blocks: string[] = []
  for (const conv of conversations as { id: string; contact_name: string | null; contact_phone: string }[]) {
    const msgs = convMap.get(conv.id)
    if (!msgs || msgs.length === 0) continue

    const label = conv.contact_name ? `${conv.contact_name} (${conv.contact_phone})` : conv.contact_phone
    const lines = msgs.map((m) => {
      const prefix = m.direction === 'inbound' ? 'usuario' : 'agente'
      const text = m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content
      return `${prefix}: ${text}`
    })
    blocks.push(`[${label}]\n${lines.join('\n')}`)
  }

  const conversationText = blocks.join('\n\n---\n\n')
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{user_goal}', user_goal.trim())
  const userMessage = `CONVERSAS PARA ANÁLISE:\n\n${conversationText}`

  // ── Call AI provider ───────────────────────────────────────────────────────
  let rawText = ''

  try {
    if (selectedProvider === 'gemini') {
      const apiVersion = selectedModel!.startsWith('gemini-2.5') ? 'v1beta' : 'v1'
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${apiVersion}/models/${selectedModel}:generateContent?key=${selectedKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            generationConfig: { temperature: 0.3 },
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        const msg = data?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: `Erro do provedor Gemini: ${msg}` }, { status: 502 })
      }
      rawText = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? ''
    } else if (selectedProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selectedKey}` },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: `Erro do provedor OpenAI: ${msg}` }, { status: 502 })
      }
      rawText = data.choices?.[0]?.message?.content ?? ''
    } else {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${selectedKey}`,
          'HTTP-Referer': 'https://flashflow.app',
          'X-Title': 'FlashFlow',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: `Erro do provedor OpenRouter: ${msg}` }, { status: 502 })
      }
      rawText = data.choices?.[0]?.message?.content ?? ''
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ ok: false, error: `Falha na chamada ao provedor de IA: ${msg}` }, { status: 502 })
  }

  // ── Parse JSON response ────────────────────────────────────────────────────
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'O modelo retornou uma resposta inválida. Tente novamente.' },
      { status: 500 }
    )
  }

  // Validação integral da saída — nunca repassa campos inesperados que o
  // modelo possa ter incluído, e recusa formas fora dos limites esperados
  // (tamanho, quantidade de sugestões, tipos, keywords).
  const validation = validateAnalysisResult(parsed)
  if (!validation.ok || !validation.data) {
    return NextResponse.json(
      { ok: false, error: validation.error ?? 'Resposta da IA em formato inesperado.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, result: validation.data })
}

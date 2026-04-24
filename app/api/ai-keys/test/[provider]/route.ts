import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/ai-crypto'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/ai-keys/test/[provider] — test connectivity using saved key
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params

  const { data, error } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('encrypted_key, iv, auth_tag, custom_model')
    .eq('provider', provider)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'Chave não encontrada. Salve a chave primeiro.' }, { status: 404 })
  }

  let apiKey: string
  try {
    apiKey = decrypt(data.encrypted_key, data.iv, data.auth_tag)
  } catch {
    return NextResponse.json({ ok: false, error: 'Falha ao descriptografar a chave.' }, { status: 500 })
  }

  const start = Date.now()

  try {
    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "ok" in one word.' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: msg })
      }
      return NextResponse.json({ ok: true, latency_ms: Date.now() - start, model_used: 'gemini-2.5-flash' })
    }

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          max_tokens: 5,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: msg })
      }
      return NextResponse.json({ ok: true, latency_ms: Date.now() - start, model_used: 'gpt-4o-mini' })
    }

    if (provider === 'openrouter') {
      const model = data.custom_model || 'openai/gpt-4o-mini'
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://flashflow.app',
          'X-Title': 'FlashFlow',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          max_tokens: 5,
        }),
      })
      const body = await res.json().catch(() => ({}))
      console.error('[ai-keys test openrouter] status:', res.status, 'body:', JSON.stringify(body))
      if (!res.ok) {
        const msg = body?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: msg })
      }
      return NextResponse.json({ ok: true, latency_ms: Date.now() - start, model_used: model })
    }

    return NextResponse.json({ ok: false, error: 'Provider inválido' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro de rede' })
  }
}

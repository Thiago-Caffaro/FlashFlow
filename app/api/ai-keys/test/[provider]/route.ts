import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/ai-crypto'
import { checkToolSupport } from '@/lib/ai-tool-check'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o-mini',
}

// POST /api/ai-keys/test/[provider] — test connectivity using saved key, then check tool support
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

  const model = (data.custom_model as string | null) || PROVIDER_DEFAULT_MODELS[provider] || 'openai/gpt-4o-mini'
  const start = Date.now()

  try {
    // ── Connectivity test ──
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
    } else if (provider === 'openai') {
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
    } else if (provider === 'openrouter') {
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
      console.log('[ai-keys test openrouter] status:', res.status, 'body:', JSON.stringify(body))
      if (!res.ok) {
        const msg = body?.error?.message ?? `HTTP ${res.status}`
        return NextResponse.json({ ok: false, error: msg })
      }
    } else {
      return NextResponse.json({ ok: false, error: 'Provider inválido' }, { status: 400 })
    }

    // ── Tool support check ──
    const toolsSupported = await checkToolSupport(provider, apiKey, model)

    await supabaseAdmin
      .from('ai_provider_keys')
      .update({ tools_supported: toolsSupported, updated_at: new Date().toISOString() })
      .eq('provider', provider)

    return NextResponse.json({
      ok: true,
      latency_ms: Date.now() - start,
      model_used: model,
      tools_supported: toolsSupported,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro de rede' })
  }
}

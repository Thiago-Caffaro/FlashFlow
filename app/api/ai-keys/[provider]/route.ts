import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/ai-crypto'
import { checkToolSupport } from '@/lib/ai-tool-check'

export const dynamic = 'force-dynamic'

const VALID_PROVIDERS = ['gemini', 'openai', 'openrouter'] as const
type Provider = (typeof VALID_PROVIDERS)[number]

const PROVIDER_DEFAULT_MODELS: Record<Provider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o-mini',
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PUT /api/ai-keys/[provider] — save/update encrypted key
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json({ ok: false, error: 'Invalid provider' }, { status: 400 })
  }

  const { key, customModel } = await req.json()
  if (!key?.trim()) {
    return NextResponse.json({ ok: false, error: 'key is required' }, { status: 400 })
  }

  const rawKey = key.trim()
  const model = customModel?.trim() || PROVIDER_DEFAULT_MODELS[provider as Provider]

  const toolsSupported = await checkToolSupport(provider, rawKey, model)

  const { encrypted_key, iv, auth_tag } = encrypt(rawKey)

  const { error } = await supabaseAdmin.from('ai_provider_keys').upsert(
    {
      provider,
      encrypted_key,
      iv,
      auth_tag,
      custom_model: customModel?.trim() || null,
      tools_supported: toolsSupported,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider' }
  )

  if (error) {
    console.error('[ai-keys PUT] Supabase error:', error.message, error.code)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, tools_supported: toolsSupported })
}

// DELETE /api/ai-keys/[provider] — remove key
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const { error } = await supabaseAdmin.from('ai_provider_keys').delete().eq('provider', provider)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

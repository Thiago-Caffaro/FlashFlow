import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/ai-crypto'
import { checkToolSupport } from '@/lib/ai-tool-check'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PATCH /api/ai-keys/[provider]/model — update default model and re-check tool support
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const { model } = await req.json()

  if (!model?.trim()) {
    return NextResponse.json({ ok: false, error: 'model is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('encrypted_key, iv, auth_tag')
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

  const toolsSupported = await checkToolSupport(provider, apiKey, model.trim())

  const { error: updateError } = await supabaseAdmin
    .from('ai_provider_keys')
    .update({
      custom_model: model.trim(),
      tools_supported: toolsSupported,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', provider)

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, tools_supported: toolsSupported })
}

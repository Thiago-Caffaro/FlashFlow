import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/ai-keys — returns which providers are configured (never the raw key)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('provider, custom_model, updated_at')

  if (error) return NextResponse.json({ ok: false, configured: [] }, { status: 500 })

  const configured: Record<string, { custom_model?: string; updated_at: string }> = {}
  for (const row of data ?? []) {
    configured[row.provider] = { custom_model: row.custom_model, updated_at: row.updated_at }
  }

  return NextResponse.json({ ok: true, configured })
}

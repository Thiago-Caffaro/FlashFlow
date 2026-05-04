import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DEFAULTS = {
  history_limit: 20,
  timeout_minutes_enabled: true,
  timeout_minutes: 360,
  timeout_messages_enabled: false,
  timeout_messages: 50,
  response_delay_ms: 5000,
  inactivity_message: '',
}

// GET /api/instance-ai-config?instance=xxx
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('instance_ai_config')
    .select('history_limit, timeout_minutes_enabled, timeout_minutes, timeout_messages_enabled, timeout_messages, response_delay_ms, inactivity_message')
    .eq('instance_name', instance)
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, config: data ?? DEFAULTS })
}

// PUT /api/instance-ai-config
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const {
    instance,
    history_limit,
    timeout_minutes_enabled,
    timeout_minutes,
    timeout_messages_enabled,
    timeout_messages,
    response_delay_ms,
    inactivity_message,
  } = body

  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('instance_ai_config')
    .upsert(
      {
        instance_name: instance,
        history_limit,
        timeout_minutes_enabled,
        timeout_minutes,
        timeout_messages_enabled,
        timeout_messages,
        response_delay_ms,
        inactivity_message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'instance_name' }
    )

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

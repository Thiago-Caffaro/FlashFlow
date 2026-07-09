import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TriggerCreate } from '@/types'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/triggers?instance=<instanceName>
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('triggers')
      .select('*')
      .eq('instance_name', instance)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[triggers GET]', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, triggers: data ?? [] })
  } catch (err) {
    console.error('[triggers GET] unexpected:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/triggers
export async function POST(req: NextRequest) {
  try {
    const body: TriggerCreate = await req.json()
    const { instance_name, tipo, action } = body

    if (!instance_name || !tipo || !action) {
      return NextResponse.json({ ok: false, error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('triggers')
      .insert({
        instance_name,
        alias: body.alias ?? '',
        tipo,
        valor: body.valor ?? '',
        delay_ms: body.delay_ms ?? 0,
        action,
        action_payload: body.action_payload ?? {},
        source: body.source ?? 'message',
      })
      .select()
      .single()

    if (error) {
      console.error('[triggers POST]', error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, trigger: data })
  } catch (err) {
    console.error('[triggers POST] unexpected:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

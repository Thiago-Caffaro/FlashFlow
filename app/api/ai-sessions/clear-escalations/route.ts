import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: NextRequest) {
  try {
    const { instance } = await req.json()
    if (!instance) {
      return NextResponse.json({ error: 'instance obrigatório' }, { status: 400 })
    }

    await supabase
      .from('ai_sessions')
      .update({ requires_human: false })
      .eq('instance_name', instance)
      .eq('requires_human', true)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('clear-escalations error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

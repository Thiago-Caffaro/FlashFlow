import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { belongsToInstance } from '@/lib/instance-guard'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const instanceName: string = typeof body.instance_name === 'string' ? body.instance_name : ''
    if (!instanceName) return NextResponse.json({ error: 'instance_name obrigatório' }, { status: 400 })
    if (!(await belongsToInstance(supabase, 'ai_sessions', id, instanceName))) {
      return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
    }

    await supabase
      .from('ai_sessions')
      .update({ requires_human: false, pending_messages: [] })
      .eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('release error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TriggerCreate } from '@/types'
import { belongsToInstance } from '@/lib/instance-guard'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PUT /api/triggers/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body: Partial<TriggerCreate> & { instance_name?: string } = await req.json()

  const instanceName = typeof body.instance_name === 'string' ? body.instance_name : ''
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance_name obrigatório' }, { status: 400 })
  }
  if (!(await belongsToInstance(supabaseAdmin, 'triggers', id, instanceName))) {
    return NextResponse.json({ ok: false, error: 'Gatilho não encontrado' }, { status: 404 })
  }

  // Allowlist explícita — nunca deixa o cliente sobrescrever id/instance_name/timestamps.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.alias === 'string') patch.alias = body.alias
  if (typeof body.tipo === 'string') patch.tipo = body.tipo
  if (typeof body.valor === 'string') patch.valor = body.valor
  if (typeof body.delay_ms === 'number') patch.delay_ms = body.delay_ms
  if (typeof body.action === 'string') patch.action = body.action
  if (body.action_payload !== undefined) patch.action_payload = body.action_payload
  if (typeof body.source === 'string') patch.source = body.source

  const { data, error } = await supabaseAdmin
    .from('triggers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, trigger: data })
}

// DELETE /api/triggers/[id]?instance=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const instanceName = req.nextUrl.searchParams.get('instance') ?? ''
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance obrigatório' }, { status: 400 })
  }
  if (!(await belongsToInstance(supabaseAdmin, 'triggers', id, instanceName))) {
    return NextResponse.json({ ok: false, error: 'Gatilho não encontrado' }, { status: 404 })
  }

  const { error } = await supabaseAdmin.from('triggers').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

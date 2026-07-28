import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { belongsToInstance } from '@/lib/instance-guard'
import { validateFlowJson } from '@/lib/flow-validation'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PUT /api/flows/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await req.json()
    const instanceName: string = typeof body.instance_name === 'string' ? body.instance_name : ''
    if (!instanceName) {
      return NextResponse.json({ ok: false, error: 'instance_name obrigatório' }, { status: 400 })
    }
    if (!(await belongsToInstance(supabaseAdmin, 'flows', id, instanceName))) {
      return NextResponse.json({ ok: false, error: 'Fluxo não encontrado' }, { status: 404 })
    }

    // Allowlist explícita — nunca deixa o cliente sobrescrever id/instance_name/timestamps.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string') patch.name = body.name
    if (body.json !== undefined) {
      const validation = validateFlowJson(body.json)
      if (!validation.ok) {
        return NextResponse.json({ ok: false, error: validation.error }, { status: 422 })
      }
      patch.json = body.json
    }
    if (typeof body.ativo === 'boolean') patch.ativo = body.ativo

    const { data, error } = await supabaseAdmin
      .from('flows')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, flow: data })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// DELETE /api/flows/[id]?instance=xxx
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const instanceName = req.nextUrl.searchParams.get('instance') ?? ''
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance obrigatório' }, { status: 400 })
  }
  if (!(await belongsToInstance(supabaseAdmin, 'flows', id, instanceName))) {
    return NextResponse.json({ ok: false, error: 'Fluxo não encontrado' }, { status: 404 })
  }

  const { error } = await supabaseAdmin.from('flows').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

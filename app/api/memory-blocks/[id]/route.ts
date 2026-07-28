import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { belongsToInstance } from '@/lib/instance-guard'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PUT /api/memory-blocks/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, content, type, keywords, instance_name } = body

    const instanceName = typeof instance_name === 'string' ? instance_name : ''
    if (!instanceName) {
      return NextResponse.json({ ok: false, error: 'instance_name obrigatório' }, { status: 400 })
    }
    if (!(await belongsToInstance(supabaseAdmin, 'agent_memory_blocks', id, instanceName))) {
      return NextResponse.json({ ok: false, error: 'Bloco não encontrado' }, { status: 404 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name.trim()
    if (content !== undefined) updates.content = content.trim()
    if (type !== undefined) updates.type = type
    if (keywords !== undefined) updates.keywords = keywords

    const { data, error } = await supabaseAdmin
      .from('agent_memory_blocks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, block: data })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// DELETE /api/memory-blocks/[id]?instance=xxx
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const instanceName = req.nextUrl.searchParams.get('instance') ?? ''
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance obrigatório' }, { status: 400 })
  }
  if (!(await belongsToInstance(supabaseAdmin, 'agent_memory_blocks', id, instanceName))) {
    return NextResponse.json({ ok: false, error: 'Bloco não encontrado' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('agent_memory_blocks')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

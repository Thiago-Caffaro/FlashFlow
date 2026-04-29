import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const newName: string = (body.filename ?? '').trim()
  if (!newName) return NextResponse.json({ error: 'filename obrigatório' }, { status: 400 })

  // Preserve extension from current filename
  const { data: current, error: fetchError } = await supabase
    .from('flow_media')
    .select('filename')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const ext = current.filename.includes('.') ? current.filename.split('.').pop()! : ''
  const finalName = ext ? `${newName}.${ext}` : newName

  const { data, error } = await supabase
    .from('flow_media')
    .update({ filename: finalName })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data, error } = await supabase
    .from('flow_media')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  await supabase.storage.from('media').remove([data.storage_path])

  const { error: delError } = await supabase.from('flow_media').delete().eq('id', id)
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

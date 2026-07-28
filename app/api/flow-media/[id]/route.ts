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
  const instanceName: string = typeof body.instance_name === 'string' ? body.instance_name : ''
  if (!newName) return NextResponse.json({ error: 'filename obrigatório' }, { status: 400 })
  if (!instanceName) return NextResponse.json({ error: 'instance_name obrigatório' }, { status: 400 })

  // Preserve extension from current filename — também confirma que o item
  // pertence à instância informada antes de qualquer alteração.
  const { data: current, error: fetchError } = await supabase
    .from('flow_media')
    .select('filename, instance_name')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!current || current.instance_name !== instanceName) {
    return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  }

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const instanceName = req.nextUrl.searchParams.get('instance') ?? ''
  if (!instanceName) return NextResponse.json({ error: 'instance obrigatório' }, { status: 400 })

  const { data, error } = await supabase
    .from('flow_media')
    .select('storage_path, instance_name')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.instance_name !== instanceName) {
    return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  }

  await supabase.storage.from('media').remove([data.storage_path])

  const { error: delError } = await supabase.from('flow_media').delete().eq('id', id)
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

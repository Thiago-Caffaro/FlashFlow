import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadFileToStorage } from '@/lib/storage'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_SIZE = 512_000 // 500 KB

export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ error: 'instance obrigatório' }, { status: 400 })

  const { data, error } = await supabase
    .from('flow_media')
    .select('*')
    .eq('instance_name', instance)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const instanceName = formData.get('instanceName') as string | null

    if (!file || !instanceName) {
      return NextResponse.json({ error: 'file e instanceName são obrigatórios' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Apenas imagens são permitidas' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Imagem excede o limite de 500KB' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const { path, url } = await uploadFileToStorage(buffer, file.name, file.type, 'flow-images/')

    const { data, error } = await supabase
      .from('flow_media')
      .insert({
        instance_name: instanceName,
        filename: file.name,
        storage_path: path,
        url,
        size_bytes: file.size,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('flow-media POST error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

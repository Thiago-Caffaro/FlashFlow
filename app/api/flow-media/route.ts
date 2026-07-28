import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadFileToStorage } from '@/lib/storage'
import { extensionForSniffedType, sniffImageType } from '@/lib/image-validation'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_SIZE = 512_000 // 500 KB

/**
 * Sanitiza o nome original para uso como metadado de exibição apenas — nunca
 * é usado para montar o caminho de armazenamento (esse é sempre aleatório).
 * Remove separadores de caminho e caracteres de controle, e limita o tamanho.
 */
function sanitizeDisplayFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
  return (cleaned || 'imagem').slice(0, 200)
}

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

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Imagem excede o limite de 500KB' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    // Nunca confia no Content-Type/nome enviado pelo cliente — detecta o
    // formato real pelos magic bytes. SVG e outros formatos "ativos" nunca
    // passam aqui, apenas raster puro (jpeg/png/gif/webp).
    const sniffed = sniffImageType(Buffer.from(buffer))
    if (!sniffed) {
      return NextResponse.json({ error: 'Formato de imagem não suportado ou arquivo corrompido' }, { status: 400 })
    }
    const safeFilename = `image.${extensionForSniffedType(sniffed)}`
    const { path, url } = await uploadFileToStorage(buffer, safeFilename, sniffed, 'flow-images/')

    const { data, error } = await supabase
      .from('flow_media')
      .insert({
        instance_name: instanceName,
        filename: sanitizeDisplayFilename(file.name),
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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getPicUrl(remoteJid: string, phone: string, instanceName: string): Promise<string | null> {
  // 1. Tenta banco (Contact da Evolution — requer GRANT SELECT na tabela)
  const { data } = await supabaseAdmin
    .from('Contact')
    .select('profilePicUrl')
    .eq('remoteJid', remoteJid)
    .maybeSingle()

  const dbUrl = (data as { profilePicUrl?: string | null } | null)?.profilePicUrl
  if (dbUrl) return dbUrl

  // 2. Fallback: Evolution API HTTP (com timeout de 5s)
  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 5000)
    const res = await fetch(
      `${process.env.EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${instanceName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY! },
        body: JSON.stringify({ number: phone }),
        signal: abort.signal,
      }
    )
    clearTimeout(timer)
    if (res.ok) {
      const json = await res.json()
      return json?.profilePictureUrl ?? null
    }
  } catch { /* sem foto ou timeout */ }

  return null
}

export async function GET(req: NextRequest) {
  const waId = req.nextUrl.searchParams.get('waId')
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'
  if (!waId) return new NextResponse(null, { status: 404 })
  // Tipos sem foto de perfil ou que causam timeout na Evolution API
  if (
    waId.includes('@broadcast') ||
    waId.includes('@g.us') ||
    waId.includes('@lid') ||
    waId === '0@s.whatsapp.net'
  ) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const remoteJid = waId.includes('@') ? waId : `${waId}@s.whatsapp.net`
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')

    const picUrl = await getPicUrl(remoteJid, phone, instanceName)
    if (!picUrl) return new NextResponse(null, { status: 404 })

    const imgRes = await fetch(picUrl, {
      headers: { 'User-Agent': 'WhatsApp/2.24.6.77 A' },
    })
    if (!imgRes.ok) return new NextResponse(null, { status: 404 })

    const buffer = await imgRes.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': imgRes.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}

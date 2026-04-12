import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

const CACHE_HIT = 'public, max-age=86400, stale-while-revalidate=604800'
const CACHE_MISS = 'public, max-age=3600'

const MIME_TYPE: Record<string, string> = {
  stickerMessage: 'image/webp',
  imageMessage: 'image/jpeg',
  videoMessage: 'video/mp4',
  audioMessage: 'audio/ogg',
  pttMessage: 'audio/ogg',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  const fromMe = searchParams.get('fromMe') === 'true'
  const remoteJid = searchParams.get('remoteJid')
  const instance = searchParams.get('instance') ?? 'flashflow-main'
  const msgType = searchParams.get('type') ?? 'stickerMessage'

  if (!id || !remoteJid) {
    return new NextResponse(null, { status: 400, headers: { 'Cache-Control': CACHE_MISS } })
  }

  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15000)

    const res = await fetch(
      `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${instance}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
        body: JSON.stringify({
          message: {
            key: { id, fromMe, remoteJid },
            messageType: msgType,
          },
          convertToMp4: msgType === 'videoMessage',
        }),
        signal: abort.signal,
      }
    )
    clearTimeout(timer)

    if (!res.ok) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    const json = await res.json()
    const base64: string | undefined = json?.base64

    if (!base64) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    // Strip "data:...;base64," prefix if present
    const raw = base64.includes(',') ? base64.split(',')[1] : base64
    const mime = MIME_TYPE[msgType] ?? 'application/octet-stream'
    const buffer = Buffer.from(raw, 'base64')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': CACHE_HIT,
      },
    })
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }
}

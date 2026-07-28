import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

const CACHE_HIT = 'private, max-age=86400, stale-while-revalidate=604800'
const CACHE_MISS = 'private, max-age=3600'

const MIME_TYPE: Record<string, string> = {
  stickerMessage: 'image/webp',
  imageMessage: 'image/jpeg',
  videoMessage: 'video/mp4',
  audioMessage: 'audio/ogg; codecs=opus',
  pttMessage: 'audio/ogg; codecs=opus',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  const msgType = searchParams.get('type') ?? 'stickerMessage'

  if (!id) {
    return new NextResponse(null, { status: 400, headers: { 'Cache-Control': CACHE_MISS } })
  }

  try {
    // remoteJid, instance e fromMe nunca vêm do cliente — são derivados da
    // mensagem localizada no banco (duas consultas sequenciais, sem depender
    // de embed via foreign key), para impedir que os parâmetros da URL sejam
    // adulterados para puxar mídia de outra conversa/instância.
    const { data: message } = await supabase
      .from('messages')
      .select('direction, conversation_id')
      .eq('wa_message_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!message) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('wa_id, instance_name')
      .eq('id', message.conversation_id)
      .maybeSingle()

    if (!conversation) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    const remoteJid = conversation.wa_id
    const instance = conversation.instance_name
    const fromMe = message.direction === 'outbound'

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
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }
}

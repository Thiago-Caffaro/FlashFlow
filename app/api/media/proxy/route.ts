import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchEvolution } from '@/lib/evolution-api'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const log = createLogger('media-proxy')

const CACHE_HIT = 'private, max-age=86400, stale-while-revalidate=604800'
const CACHE_MISS = 'private, max-age=3600'
const MEDIA_TIMEOUT_MS = 15_000

const MIME_TYPE: Record<string, string> = {
  stickerMessage: 'image/webp',
  imageMessage: 'image/jpeg',
  videoMessage: 'video/mp4',
  audioMessage: 'audio/ogg; codecs=opus',
  pttMessage: 'audio/ogg; codecs=opus',
}

function notFound() {
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
}

// Mídia sob demanda (áudio, vídeo, figurinha e imagens que não foram
// baixadas no webhook): busca na Evolution a cada visualização. O 404 para o
// navegador continua igual, mas agora o motivo fica no log — antes "a
// imagem não carrega" não deixava rastro.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  const msgType = searchParams.get('type') ?? 'stickerMessage'

  if (!id) {
    return new NextResponse(null, { status: 400, headers: { 'Cache-Control': CACHE_MISS } })
  }

  let instance = ''
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
      log.debug('mensagem não encontrada para mídia', { msgId: id })
      return notFound()
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('wa_id, instance_name')
      .eq('id', message.conversation_id)
      .maybeSingle()

    if (!conversation) return notFound()

    const remoteJid = conversation.wa_id
    instance = conversation.instance_name
    const fromMe = message.direction === 'outbound'

    const response = await fetchEvolution(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            key: { id, fromMe, remoteJid },
            messageType: msgType,
          },
          convertToMp4: msgType === 'videoMessage',
        }),
      },
      MEDIA_TIMEOUT_MS
    )

    const body = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
    const base64 = typeof body.base64 === 'string' ? body.base64 : ''
    if (!response.ok || !base64) {
      // Mesmo motivo se repete para várias mensagens (instância fora do ar,
      // mídia expirada no WhatsApp) — uma linha por janela basta.
      log.warn('Evolution não entregou a mídia', {
        instance,
        msgId: id,
        msgType,
        status: response.status,
        body: response.text.slice(0, 200),
      }, { throttleKey: `${instance}:${response.status}` })
      return notFound()
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
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    log.warn(timedOut ? 'Evolution não respondeu a tempo ao buscar mídia' : 'falha ao buscar mídia', {
      instance: instance || undefined,
      msgId: id,
      err: error,
    }, { throttleKey: `${instance}:${timedOut ? 'timeout' : 'error'}` })
    return notFound()
  }
}

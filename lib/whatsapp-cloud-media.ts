import 'server-only'
import { fetchCloudApi } from './whatsapp-cloud-client'
import { storeMediaBuffer } from './media-storage'
import { decodeCloudAccessToken, type WhatsAppCloudCredentialsRow } from './whatsapp-cloud-credentials'
import { createLogger } from './logger'

const log = createLogger('whatsapp-cloud-media')

// Mesmo teto usado no upload manual de imagem pelo operador
// (app/api/messages/image/route.ts) — mantém paridade de limite nos dois sentidos.
const MAX_MEDIA_SIZE = 5 * 1024 * 1024 // 5 MB

interface CloudMediaMeta {
  url: string
  mimeType: string
  fileSize: number | null
}

type MediaFailure = (reason: string, context?: Record<string, unknown>) => null

async function resolveCloudMediaMeta(
  mediaId: string,
  accessToken: string,
  fail: MediaFailure
): Promise<CloudMediaMeta | null> {
  const response = await fetchCloudApi(`/${mediaId}`, accessToken, { method: 'GET' }, 10_000)
  if (!response.ok) {
    return fail('Graph API recusou os metadados da mídia', { status: response.status, body: response.text.slice(0, 200) })
  }
  const record = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
  const url = typeof record.url === 'string' ? record.url : null
  if (!url) return fail('metadados da mídia sem URL')
  return {
    url,
    mimeType: typeof record.mime_type === 'string' ? record.mime_type : 'application/octet-stream',
    fileSize: typeof record.file_size === 'number' ? record.file_size : null,
  }
}

// A Meta nunca entrega mídia inline (diferente da Evolution, que pode mandar
// base64 no próprio payload do webhook) — sempre um media_id que precisa de
// duas requisições autenticadas: metadados (URL temporária + mime) e depois
// os bytes propriamente ditos. A URL temporária expira em minutos, então as
// duas chamadas acontecem em sequência, sem cache entre elas.
//
// Toda falha devolve null (a mensagem fica com o placeholder) com o motivo
// no log — antes eram cinco saídas silenciosas.
export async function resolveAndStoreCloudMedia(
  mediaId: string,
  credentials: WhatsAppCloudCredentialsRow
): Promise<string | null> {
  const fail: MediaFailure = (reason, context = {}) => {
    log.warn(`mídia não baixada: ${reason}`, { instance: credentials.instance_name, mediaId, ...context }, {
      throttleKey: `${credentials.instance_name}:${reason}`,
    })
    return null
  }
  try {
    const accessToken = decodeCloudAccessToken(credentials)
    const meta = await resolveCloudMediaMeta(mediaId, accessToken, fail)
    if (!meta) return null
    if (meta.fileSize !== null && meta.fileSize > MAX_MEDIA_SIZE) return fail('arquivo acima do limite', { bytes: meta.fileSize })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let buffer: Buffer
    try {
      const mediaRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      })
      if (!mediaRes.ok) return fail('download dos bytes recusado', { status: mediaRes.status })
      const arrayBuffer = await mediaRes.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_MEDIA_SIZE) return fail('arquivo acima do limite', { bytes: arrayBuffer.byteLength })
      buffer = Buffer.from(arrayBuffer)
    } finally {
      clearTimeout(timeout)
    }

    return storeMediaBuffer(buffer, meta.mimeType, mediaId)
  } catch (error) {
    return fail(error instanceof Error && error.name === 'AbortError' ? 'download expirou' : 'erro inesperado', { err: error })
  }
}

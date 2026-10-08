import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createLogger } from './logger'

// Bucket público compartilhado por toda mídia recebida via WhatsApp (Evolution
// e Cloud API) e pela galeria de mídia dos fluxos.
const MEDIA_BUCKET = 'media'
const log = createLogger('media-storage')

// createBucket a cada upload era uma chamada extra ao Storage por imagem —
// basta garantir uma vez por processo.
let bucketEnsured = false

export async function ensureMediaBucket(): Promise<void> {
  if (bucketEnsured) return
  // "already exists" também é sucesso; outros erros aparecem no upload.
  await supabaseAdmin.storage.createBucket(MEDIA_BUCKET, { public: true }).catch(() => {})
  bucketEnsured = true
}

export async function storeMediaBuffer(
  buffer: Buffer,
  mimetype: string,
  id: string
): Promise<string | null> {
  try {
    const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'jpg'
    const path = `${Date.now()}-${id}.${ext}`

    await ensureMediaBucket()

    const { error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimetype })
    if (error) {
      log.warn('upload de mídia falhou — mensagem fica com placeholder', {
        msgId: id,
        bytes: buffer.length,
        mimetype,
        err: error,
      }, { throttleKey: `upload:${error.message}` })
      return null
    }

    const { data: { publicUrl } } = supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    return publicUrl
  } catch (error) {
    log.warn('upload de mídia falhou', { msgId: id, err: error }, { throttleKey: 'upload:exception' })
    return null
  }
}

export async function storeBase64Media(
  base64Raw: string,
  mimetype: string,
  id: string
): Promise<string | null> {
  const b64Data = base64Raw.includes(',') ? base64Raw.split(',')[1] : base64Raw
  if (!b64Data) {
    log.warn('base64 de mídia vazio — nada para gravar', { msgId: id })
    return null
  }
  return storeMediaBuffer(Buffer.from(b64Data, 'base64'), mimetype, id)
}

export function _resetMediaBucketCacheForTests(): void {
  bucketEnsured = false
}

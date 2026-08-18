import 'server-only'
import { supabaseAdmin } from './supabase-admin'

// Bucket público compartilhado por toda mídia recebida via WhatsApp (Evolution
// e Cloud API) e pela galeria de mídia dos fluxos.
const MEDIA_BUCKET = 'media'

export async function ensureMediaBucket(): Promise<void> {
  await supabaseAdmin.storage.createBucket(MEDIA_BUCKET, { public: true }).catch(() => {})
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
    if (error) return null

    const { data: { publicUrl } } = supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    return publicUrl
  } catch {
    return null
  }
}

export async function storeBase64Media(
  base64Raw: string,
  mimetype: string,
  id: string
): Promise<string | null> {
  const b64Data = base64Raw.includes(',') ? base64Raw.split(',')[1] : base64Raw
  if (!b64Data) return null
  return storeMediaBuffer(Buffer.from(b64Data, 'base64'), mimetype, id)
}

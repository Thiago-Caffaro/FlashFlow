import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function ensureMediaBucket() {
  await supabase.storage.createBucket('media', { public: true }).catch(() => {})
}

export async function uploadFileToStorage(
  data: Buffer | ArrayBuffer,
  originalFilename: string,
  contentType: string,
  prefix = ''
): Promise<{ path: string; url: string }> {
  await ensureMediaBucket()

  const ext = originalFilename.split('.').pop() ?? 'bin'
  const random = Math.random().toString(36).slice(2)
  const path = `${prefix}${Date.now()}-${random}.${ext}`

  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data

  const { error } = await supabase.storage
    .from('media')
    .upload(path, buffer, { contentType })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path)
  return { path, url: publicUrl }
}

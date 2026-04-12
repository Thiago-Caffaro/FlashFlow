import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CACHE_HIT = 'public, max-age=3600, stale-while-revalidate=86400'
const CACHE_MISS = 'public, max-age=3600'

/** Calls Evolution API to get a fresh profile picture URL. */
async function fetchFromEvolution(phone: string, instanceName: string): Promise<string | null> {
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
  } catch { /* timeout or no picture */ }
  return null
}

/**
 * Resolves the profile picture URL for a contact, checking sources in order:
 * 1. Our conversations table (fastest — populated by sync)
 * 2. Evolution API's Contact table (internal DB)
 * 3. Evolution API live call (slowest — fallback only)
 */
async function getPicUrl(remoteJid: string, phone: string, instanceName: string): Promise<string | null> {
  // 1. Check our own conversations table first (populated by sync)
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('profile_pic_url')
    .eq('wa_id', remoteJid)
    .eq('instance_name', instanceName)
    .maybeSingle()

  const storedUrl = (conv as { profile_pic_url?: string | null } | null)?.profile_pic_url
  if (storedUrl) return storedUrl

  // 2. Check Evolution's Contact table (requires GRANT SELECT on public."Contact")
  const { data: contact } = await supabaseAdmin
    .from('Contact')
    .select('profilePicUrl')
    .eq('remoteJid', remoteJid)
    .maybeSingle()

  const contactUrl = (contact as { profilePicUrl?: string | null } | null)?.profilePicUrl
  if (contactUrl) return contactUrl

  // 3. Live call to Evolution API
  return fetchFromEvolution(phone, instanceName)
}

export async function GET(req: NextRequest) {
  const waId = req.nextUrl.searchParams.get('waId')
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'

  if (!waId) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }

  // These contact types never have resolvable profile pictures — return immediately.
  // The client skips @lid requests, but we guard here too for safety.
  if (
    waId.includes('@broadcast') ||
    waId.includes('@g.us') ||
    waId.includes('@lid') ||
    waId === '0@s.whatsapp.net'
  ) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }

  try {
    const remoteJid = waId.includes('@') ? waId : `${waId}@s.whatsapp.net`
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')

    const picUrl = await getPicUrl(remoteJid, phone, instanceName)
    if (!picUrl) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    let imgRes = await fetch(picUrl, { headers: { 'User-Agent': 'WhatsApp/2.24.6.77 A' } })

    // Stored URL may have expired (WhatsApp CDN URLs are time-limited).
    // Try to get a fresh URL from Evolution API and update our cache.
    if (!imgRes.ok) {
      const freshUrl = await fetchFromEvolution(phone, instanceName)
      if (freshUrl && freshUrl !== picUrl) {
        imgRes = await fetch(freshUrl, { headers: { 'User-Agent': 'WhatsApp/2.24.6.77 A' } })
        if (imgRes.ok) {
          // Persist the fresh URL so next request hits the fast path (fire-and-forget)
          supabaseAdmin
            .from('conversations')
            .update({ profile_pic_url: freshUrl })
            .eq('wa_id', remoteJid)
            .eq('instance_name', instanceName)
            .then(() => {})
            .catch(() => {})
        }
      }
    }

    if (!imgRes.ok) {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
    }

    const buffer = await imgRes.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': imgRes.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': CACHE_HIT,
      },
    })
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }
}

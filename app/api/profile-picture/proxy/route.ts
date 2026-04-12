import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CACHE_HIT = 'public, max-age=3600, stale-while-revalidate=86400'
const CACHE_MISS = 'public, max-age=3600'
const WA_UA = 'WhatsApp/2.24.6.77 A'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function fetchPicUrlFromEvolution(phone: string, instanceName: string): Promise<string | null> {
  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 6000)
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
    if (!res.ok) return null
    const json = await res.json()
    return (json?.profilePictureUrl as string) || null
  } catch {
    return null
  }
}

/** Saves the URL to conversations so future requests hit the fast path. Fire-and-forget. */
function persistPicUrl(remoteJid: string, instanceName: string, url: string) {
  supabase
    .from('conversations')
    .update({ profile_pic_url: url })
    .eq('wa_id', remoteJid)
    .eq('instance_name', instanceName)
    .then(() => {})
    .catch(() => {})
}

/**
 * Resolves a profile picture URL in order:
 * 1. conversations.profile_pic_url  (populated by sync or previous proxy hit)
 * 2. Evolution Contact table         (requires GRANT SELECT on public."Contact")
 * 3. Evolution API live call
 *
 * Always persists the result so source 1 wins on the next request.
 */
async function resolvePicUrl(
  remoteJid: string,
  phone: string,
  instanceName: string
): Promise<{ url: string; fromCache: boolean } | null> {
  // 1. Our DB
  const { data: conv } = await supabase
    .from('conversations')
    .select('profile_pic_url')
    .eq('wa_id', remoteJid)
    .eq('instance_name', instanceName)
    .maybeSingle()

  const stored = (conv as { profile_pic_url?: string | null } | null)?.profile_pic_url || null
  if (stored) return { url: stored, fromCache: true }

  // 2. Evolution Contact table
  const { data: contact } = await supabase
    .from('Contact')
    .select('profilePicUrl')
    .eq('remoteJid', remoteJid)
    .maybeSingle()

  const fromContact = (contact as { profilePicUrl?: string | null } | null)?.profilePicUrl || null
  if (fromContact) {
    persistPicUrl(remoteJid, instanceName, fromContact)
    return { url: fromContact, fromCache: false }
  }

  // 3. Live API
  const live = await fetchPicUrlFromEvolution(phone, instanceName)
  if (live) {
    persistPicUrl(remoteJid, instanceName, live)
    return { url: live, fromCache: false }
  }

  return null
}

// ─── route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const waId = req.nextUrl.searchParams.get('waId')
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'

  if (!waId) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

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
    const phone = remoteJid.replace('@s.whatsapp.net', '')

    const resolved = await resolvePicUrl(remoteJid, phone, instanceName)
    if (!resolved) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

    let picUrl = resolved.url
    let imgRes = await fetch(picUrl, { headers: { 'User-Agent': WA_UA } })

    // CDN URL expired — fetch a fresh one and persist it
    if (!imgRes.ok) {
      const fresh = await fetchPicUrlFromEvolution(phone, instanceName)
      if (fresh && fresh !== picUrl) {
        imgRes = await fetch(fresh, { headers: { 'User-Agent': WA_UA } })
        if (imgRes.ok) {
          picUrl = fresh
          persistPicUrl(remoteJid, instanceName, fresh)
        }
      }
    }

    if (!imgRes.ok) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

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

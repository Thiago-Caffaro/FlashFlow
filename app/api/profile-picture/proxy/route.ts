import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchImageSafely } from '@/lib/ssrf-guard'
import { fetchEvolution } from '@/lib/evolution-api'
import { createLogger } from '@/lib/logger'

const log = createLogger('profile-picture')

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CACHE_HIT = 'private, max-age=3600, stale-while-revalidate=86400'
const CACHE_MISS = 'private, max-age=3600'
const WA_UA = 'WhatsApp/2.24.6.77 A'

// ─── helpers ──────────────────────────────────────────────────────────────────

// "Sem foto" (200 com profilePictureUrl null) é o caso normal de contato com
// foto restrita na privacidade — debug. Falha da Evolution (status de erro,
// timeout) é outra coisa e vai para warn: antes as duas viravam o mesmo 404
// silencioso e "os ícones não aparecem" não tinha diagnóstico.
async function fetchPicUrlFromEvolution(phone: string, instanceName: string): Promise<string | null> {
  try {
    const response = await fetchEvolution(
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone }),
      },
      6000
    )
    if (!response.ok) {
      log.warn('Evolution falhou ao buscar foto de perfil', {
        instance: instanceName,
        status: response.status,
        body: response.text.slice(0, 200),
      }, { throttleKey: `${instanceName}:${response.status}` })
      return null
    }
    const body = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
    const url = typeof body.profilePictureUrl === 'string' && body.profilePictureUrl ? body.profilePictureUrl : null
    if (!url) log.debug('contato sem foto de perfil pública', { instance: instanceName })
    return url
  } catch (error) {
    log.warn('falha ao buscar foto de perfil na Evolution', { instance: instanceName, err: error }, {
      throttleKey: `${instanceName}:${error instanceof Error ? error.name : 'error'}`,
    })
    return null
  }
}

/** Saves the URL to conversations so future requests hit the fast path. Fire-and-forget. */
function persistPicUrl(remoteJid: string, instanceName: string, url: string) {
  void supabase
    .from('conversations')
    .update({ profile_pic_url: url })
    .eq('wa_id', remoteJid)
    .eq('instance_name', instanceName)
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
  const instanceName = req.nextUrl.searchParams.get('instance')

  if (!waId || !instanceName) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

  if (
    waId.includes('@broadcast') ||
    waId.includes('@lid') ||
    waId === '0@s.whatsapp.net'
  ) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }

  try {
    const remoteJid = waId.includes('@') ? waId : `${waId}@s.whatsapp.net`
    // For groups, pass the full JID as the "number" — Evolution API accepts it
    const phone = remoteJid.endsWith('@g.us')
      ? remoteJid
      : remoteJid.replace('@s.whatsapp.net', '')

    const resolved = await resolvePicUrl(remoteJid, phone, instanceName)
    if (!resolved) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

    let picUrl = resolved.url
    let fetched = await fetchImageSafely(picUrl, { headers: { 'User-Agent': WA_UA } })

    // CDN URL expired — fetch a fresh one and persist it
    if (!fetched.ok) {
      const fresh = await fetchPicUrlFromEvolution(phone, instanceName)
      if (fresh && fresh !== picUrl) {
        const retried = await fetchImageSafely(fresh, { headers: { 'User-Agent': WA_UA } })
        if (retried.ok) {
          fetched = retried
          picUrl = fresh
          persistPicUrl(remoteJid, instanceName, fresh)
        }
      }
    }

    if (!fetched.ok) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })

    return new NextResponse(new Uint8Array(fetched.buffer), {
      headers: {
        'Content-Type': fetched.contentType,
        'Cache-Control': CACHE_HIT,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } })
  }
}

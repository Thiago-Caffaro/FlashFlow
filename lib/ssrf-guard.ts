import 'server-only'
import { promises as dns } from 'node:dns'
import net from 'node:net'

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1', '[::1]'])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // link-local, inclui metadata de nuvem (169.254.169.254)
  if (a === 0) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.split(':').pop() ?? ''
    if (v4.includes('.')) return isPrivateIPv4(v4)
  }
  return false
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  return true // não reconhecido — trata como inseguro por padrão
}

/**
 * Confirma que uma URL é segura para o servidor buscar (proteção contra
 * SSRF): exige HTTPS, resolve o hostname via DNS e rejeita qualquer IP
 * privado/loopback/link-local (inclusive o endpoint de metadata 169.254.169.254),
 * fechando a janela de DNS rebinding em que o hostname resolveria para um IP
 * público na hora da validação e para um IP interno na hora do fetch real —
 * aqui resolvemos e buscamos a partir do mesmo endereço já validado.
 */
export async function isUrlSafeForOutboundFetch(rawUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const hostname = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) return false

  if (net.isIP(hostname)) {
    return !isPrivateIp(hostname)
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0) return false
    return records.every((r) => !isPrivateIp(r.address))
  } catch {
    return false
  }
}

const MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export type SafeFetchResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; reason: string }

/**
 * Busca uma imagem externa com proteções contra SSRF: valida a URL (e cada
 * redirect, manualmente — nunca deixa o fetch seguir redirects sozinho),
 * timeout, limite de tamanho de resposta e exige Content-Type de imagem.
 */
export async function fetchImageSafely(
  initialUrl: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isUrlSafeForOutboundFetch(currentUrl))) {
      return { ok: false, reason: 'url_not_allowed' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(currentUrl, {
        headers: opts.headers,
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch {
      return { ok: false, reason: 'fetch_failed' }
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { ok: false, reason: 'redirect_without_location' }
      try {
        currentUrl = new URL(location, currentUrl).toString()
      } catch {
        return { ok: false, reason: 'invalid_redirect' }
      }
      continue
    }

    if (!res.ok) return { ok: false, reason: `http_${res.status}` }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, reason: 'not_an_image' }
    }

    const declaredLength = Number(res.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: 'too_large' }
    }

    const arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength > maxBytes) {
      return { ok: false, reason: 'too_large' }
    }

    return { ok: true, buffer: Buffer.from(arrayBuffer), contentType }
  }

  return { ok: false, reason: 'too_many_redirects' }
}

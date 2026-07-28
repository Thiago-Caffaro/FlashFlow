import 'server-only'
import { promises as dns } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import net from 'node:net'
import { sniffImageType } from './image-validation'

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1', '[::1]'])
const MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

const blockedAddresses = new net.BlockList()
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4')
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4')
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4')
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4')
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4')
blockedAddresses.addSubnet('192.0.0.0', 24, 'ipv4')
blockedAddresses.addSubnet('192.0.2.0', 24, 'ipv4')
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4')
blockedAddresses.addSubnet('198.18.0.0', 15, 'ipv4')
blockedAddresses.addSubnet('198.51.100.0', 24, 'ipv4')
blockedAddresses.addSubnet('203.0.113.0', 24, 'ipv4')
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4')
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4')
blockedAddresses.addSubnet('::', 128, 'ipv6')
blockedAddresses.addSubnet('::1', 128, 'ipv6')
blockedAddresses.addSubnet('2001:db8::', 32, 'ipv6')
blockedAddresses.addSubnet('fc00::', 7, 'ipv6')
blockedAddresses.addSubnet('fe80::', 10, 'ipv6')
blockedAddresses.addSubnet('ff00::', 8, 'ipv6')

const globalIpv6Addresses = new net.BlockList()
globalIpv6Addresses.addSubnet('2000::', 3, 'ipv6')

type SafeOutboundTarget = {
  url: URL
  address: string
  family: 4 | 6
}

function isPublicIp(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return !blockedAddresses.check(address, 'ipv4')
  if (family === 6) {
    return globalIpv6Addresses.check(address, 'ipv6') &&
      !blockedAddresses.check(address, 'ipv6')
  }
  return false
}

async function resolveSafeOutboundTarget(rawUrl: string): Promise<SafeOutboundTarget | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null
  if (url.username || url.password) return null

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) return null

  const literalFamily = net.isIP(hostname)
  if (literalFamily) {
    if (!isPublicIp(hostname)) return null
    return { url, address: hostname, family: literalFamily === 6 ? 6 : 4 }
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0 || records.some((record) => !isPublicIp(record.address))) {
      return null
    }
    const selected = records[0]
    if (selected.family !== 4 && selected.family !== 6) return null
    return { url, address: selected.address, family: selected.family }
  } catch {
    return null
  }
}

export async function isUrlSafeForOutboundFetch(rawUrl: string): Promise<boolean> {
  return (await resolveSafeOutboundTarget(rawUrl)) !== null
}

type PinnedResponse =
  | { ok: true; status: number; headers: Record<string, string | string[] | undefined>; buffer: Buffer }
  | { ok: false; reason: string }

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function requestPinned(
  target: SafeOutboundTarget,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
  maxBytes: number
): Promise<PinnedResponse> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: PinnedResponse) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const request = httpsRequest({
      protocol: 'https:',
      hostname: target.address,
      port: 443,
      path: `${target.url.pathname}${target.url.search}`,
      method: 'GET',
      servername: net.isIP(target.url.hostname) ? undefined : target.url.hostname,
      headers: {
        ...headers,
        Host: target.url.host,
      },
    }, (response) => {
      const status = response.statusCode ?? 0
      const responseHeaders = response.headers as Record<string, string | string[] | undefined>

      if (status < 200 || status >= 300) {
        response.resume()
        finish({ ok: true, status, headers: responseHeaders, buffer: Buffer.alloc(0) })
        return
      }

      const declaredLength = Number(headerValue(responseHeaders['content-length']))
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy()
        finish({ ok: false, reason: 'too_large' })
        return
      }

      const chunks: Buffer[] = []
      let totalBytes = 0
      response.on('data', (chunk: Buffer | Uint8Array | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buffer.length
        if (totalBytes > maxBytes) {
          response.destroy()
          finish({ ok: false, reason: 'too_large' })
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        finish({
          ok: true,
          status,
          headers: responseHeaders,
          buffer: Buffer.concat(chunks, totalBytes),
        })
      })
      response.on('error', () => finish({ ok: false, reason: 'fetch_failed' }))
    })

    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')))
    request.on('error', () => finish({ ok: false, reason: 'fetch_failed' }))
    request.end()
  })
}

export type SafeFetchResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; reason: string }

export async function fetchImageSafely(
  initialUrl: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await resolveSafeOutboundTarget(currentUrl)
    if (!target) return { ok: false, reason: 'url_not_allowed' }

    const response = await requestPinned(target, opts.headers, timeoutMs, maxBytes)
    if (!response.ok) return response

    if (response.status >= 300 && response.status < 400) {
      const location = headerValue(response.headers.location)
      if (!location) return { ok: false, reason: 'redirect_without_location' }
      try {
        currentUrl = new URL(location, currentUrl).toString()
      } catch {
        return { ok: false, reason: 'invalid_redirect' }
      }
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `http_${response.status}` }
    }

    const declaredContentType = headerValue(response.headers['content-type'])
    if (!declaredContentType.toLowerCase().startsWith('image/')) {
      return { ok: false, reason: 'not_an_image' }
    }

    const sniffedContentType = sniffImageType(response.buffer)
    if (!sniffedContentType) {
      return { ok: false, reason: 'invalid_image_bytes' }
    }

    return {
      ok: true,
      buffer: response.buffer,
      contentType: sniffedContentType,
    }
  }

  return { ok: false, reason: 'too_many_redirects' }
}

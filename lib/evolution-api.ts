import 'server-only'
import { timingSafeEqual } from 'node:crypto'

export const EVOLUTION_WEBHOOK_SECRET_HEADER = 'x-webhook-secret'

// Limite defensivo de tamanho do corpo do webhook — eventos de mídia inline em
// base64 podem ser grandes, mas um payload legítimo não deve passar disto.
export const MAX_EVOLUTION_WEBHOOK_BODY_BYTES = 15 * 1024 * 1024

export function exceedsMaxEvolutionWebhookBodySize(contentLengthHeader: string | null): boolean {
  const contentLength = Number(contentLengthHeader ?? '0')
  return Number.isFinite(contentLength) && contentLength > MAX_EVOLUTION_WEBHOOK_BODY_BYTES
}

export const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
]

export type EvolutionConnectionState = {
  state: 'open' | 'connecting' | 'close'
  profileName: string | null
  profilePicUrl: string | null
  phone: string | null
}

type EvolutionFetchResult = {
  ok: boolean
  status: number
  body: unknown
  text: string
}

function evolutionApiUrl() {
  const url = process.env.EVOLUTION_API_URL
  if (!url) throw new Error('EVOLUTION_API_URL não configurado')
  return url.replace(/\/$/, '')
}

function evolutionApiKey() {
  const key = process.env.EVOLUTION_API_KEY
  if (!key) throw new Error('EVOLUTION_API_KEY não configurado')
  return key
}

function evolutionWebhookSecret() {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!secret) throw new Error('EVOLUTION_WEBHOOK_SECRET não configurado')
  return secret
}

/**
 * Compara o header enviado pela Evolution API no callback do webhook com o
 * segredo configurado, em tempo constante. Falha fechado quando o segredo
 * não está configurado no ambiente.
 */
export function verifyEvolutionWebhookSecret(headerValue: string | null): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!secret || !headerValue) return false
  const expected = Buffer.from(secret, 'utf8')
  const actual = Buffer.from(headerValue, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function evolutionWebhookUrl() {
  const baseUrl = process.env.WEBHOOK_BASE_URL
  if (!baseUrl) throw new Error('WEBHOOK_BASE_URL não configurado')
  return `${baseUrl.replace(/\/$/, '')}/api/webhook/evolution`
}

function parseJson(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function fetchEvolution(
  path: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<EvolutionFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${evolutionApiUrl()}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        apikey: evolutionApiKey(),
        ...init.headers,
      },
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, body: parseJson(text), text }
  } finally {
    clearTimeout(timeout)
  }
}

export function webhookConfigPayload() {
  return {
    enabled: true,
    url: evolutionWebhookUrl(),
    webhook_by_events: true,
    webhook_base64: false,
    events: EVOLUTION_WEBHOOK_EVENTS,
    headers: { [EVOLUTION_WEBHOOK_SECRET_HEADER]: evolutionWebhookSecret() },
  }
}

export async function setEvolutionWebhook(instanceName: string): Promise<boolean> {
  const encoded = encodeURIComponent(instanceName)
  const config = webhookConfigPayload()
  const payloads = [
    { webhook: config },
    config,
  ]

  for (const payload of payloads) {
    const response = await fetchEvolution(`/webhook/set/${encoded}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (response.ok) {
      console.log(`[evolution-webhook] "${instanceName}" -> ${config.url} events=${EVOLUTION_WEBHOOK_EVENTS.join(',')}`)
      return true
    }

    console.error(
      `[evolution-webhook] failed for "${instanceName}" status=${response.status} body=${response.text.slice(0, 300)}`
    )
  }

  return false
}

function normalizeState(value: unknown): EvolutionConnectionState['state'] {
  const state = String(value ?? '').toLowerCase()
  if (state === 'open') return 'open'
  if (state === 'connecting') return 'connecting'
  return 'close'
}

function phoneFromOwner(ownerRaw: unknown): string | null {
  if (typeof ownerRaw !== 'string' || !ownerRaw) return null
  return ownerRaw.replace(/@s\.whatsapp\.net$|@c\.us$/, '')
}

export async function getEvolutionConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
  try {
    const response = await fetchEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {}, 6000)
    if (!response.ok || !response.body || typeof response.body !== 'object') {
      return { state: 'close', profileName: null, profilePicUrl: null, phone: null }
    }

    const body = response.body as Record<string, unknown>
    const inst = ((body.instance && typeof body.instance === 'object') ? body.instance : body) as Record<string, unknown>
    return {
      state: normalizeState(inst.state ?? inst.connectionStatus ?? inst.status ?? body.state),
      profileName: typeof inst.profileName === 'string' ? inst.profileName : null,
      profilePicUrl: typeof inst.profilePicUrl === 'string' ? inst.profilePicUrl : null,
      phone: phoneFromOwner(inst.ownerJid ?? inst.owner ?? inst.number ?? inst.phone ?? body.ownerJid),
    }
  } catch (error) {
    console.error(`[evolution-state] "${instanceName}" failed:`, error instanceof Error ? error.message : error)
    return { state: 'close', profileName: null, profilePicUrl: null, phone: null }
  }
}

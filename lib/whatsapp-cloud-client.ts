import 'server-only'

const DEFAULT_API_VERSION = 'v21.0'

function apiVersion(): string {
  return process.env.WHATSAPP_CLOUD_API_VERSION || DEFAULT_API_VERSION
}

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${apiVersion()}${path}`
}

interface CloudFetchResult {
  ok: boolean
  status: number
  body: unknown
  text: string
}

function parseJson(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function fetchCloudApi(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<CloudFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(graphUrl(path), {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, body: parseJson(text), text }
  } finally {
    clearTimeout(timeout)
  }
}

// A Meta devolve erros como {"error":{"message","type","code","error_subcode"}}
// — extrai uma mensagem legível em vez de expor o corpo bruto da resposta.
function cloudApiErrorMessage(body: unknown, fallbackText: string): string {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const error = record?.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null
  if (error && typeof error.message === 'string') {
    const code = typeof error.code === 'number' ? ` code=${error.code}` : ''
    return `${error.message}${code}`
  }
  return fallbackText.slice(0, 300)
}

export interface SendCloudTextResult {
  waMessageId: string | null
  raw: unknown
}

function extractCloudMessageId(body: unknown): string | null {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const messages = Array.isArray(record.messages) ? record.messages as Array<Record<string, unknown>> : []
  return typeof messages[0]?.id === 'string' ? messages[0].id as string : null
}

export async function sendCloudText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
  timeoutMs?: number
): Promise<SendCloudTextResult> {
  const response = await fetchCloudApi(`/${phoneNumberId}/messages`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  }, timeoutMs)

  if (!response.ok) {
    throw new Error(
      `Falha ao enviar mensagem via WhatsApp Cloud API (${response.status}): ${cloudApiErrorMessage(response.body, response.text)}`
    )
  }

  return { waMessageId: extractCloudMessageId(response.body), raw: response.body }
}

export async function sendCloudImage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  imageUrl: string,
  caption?: string,
  timeoutMs?: number
): Promise<SendCloudTextResult> {
  const normalizedCaption = caption?.trim() ?? ''
  const response = await fetchCloudApi(`/${phoneNumberId}/messages`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, ...(normalizedCaption ? { caption: normalizedCaption } : {}) },
    }),
  }, timeoutMs)

  if (!response.ok) {
    throw new Error(
      `Falha ao enviar imagem via WhatsApp Cloud API (${response.status}): ${cloudApiErrorMessage(response.body, response.text)}`
    )
  }

  return { waMessageId: extractCloudMessageId(response.body), raw: response.body }
}

export interface VerifyCloudCredentialsResult {
  verifiedName: string | null
  displayPhoneNumber: string | null
}

// Chamada na conexão de uma nova conta: confirma que o phone_number_id e o
// token realmente se enxergam antes de gravar a conta no banco.
export async function verifyCloudCredentials(
  phoneNumberId: string,
  accessToken: string
): Promise<VerifyCloudCredentialsResult> {
  const response = await fetchCloudApi(
    `/${phoneNumberId}?fields=verified_name,display_phone_number`,
    accessToken,
    { method: 'GET' },
    10_000
  )
  if (!response.ok) {
    throw new Error(
      `Credenciais inválidas ou Phone Number ID incorreto (${response.status}): ${cloudApiErrorMessage(response.body, response.text)}`
    )
  }
  const record = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
  return {
    verifiedName: typeof record.verified_name === 'string' ? record.verified_name : null,
    displayPhoneNumber: typeof record.display_phone_number === 'string' ? record.display_phone_number : null,
  }
}

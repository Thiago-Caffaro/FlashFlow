import 'server-only'
import { request as httpsRequest } from 'node:https'

export type FulfillmentEnvironment = 'test' | 'production'

export interface FulfillmentCredentials {
  email: string
  password: string
  environment: FulfillmentEnvironment
}

export interface FulfillmentLeadItem {
  sku: string
  quantity: number
  total: number
}

export interface CreateFulfillmentLead {
  name_costumer: string
  mobile: string
  province: string
  zipcod: string
  city: string
  address: string
  total: number
  payment_type: 'COD' | 'PREPAID'
  country: string
  email?: string | null
  order_number: string
  items: FulfillmentLeadItem[]
}

export class FulfillmentApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: unknown
  ) {
    super(message)
    this.name = 'FulfillmentApiError'
  }
}

const BASE_URLS: Record<FulfillmentEnvironment, string> = {
  test: 'https://api-test.ecomfulfilment.eu',
  production: 'https://api.ecomfulfilment.eu',
}

interface ApiResponse {
  ok: boolean
  status: number
  body: Record<string, unknown>
  location?: string
}

function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { data: parsed }
  } catch {
    return { raw: raw.slice(0, 1000) }
  }
}

function responseMessage(body: Record<string, unknown>, fallback: string): string {
  const error = body.error
  if (typeof body.message === 'string' && body.message.trim()) return body.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const errorMessage = (error as Record<string, unknown>).message
    if (typeof errorMessage === 'string' && errorMessage.trim()) return errorMessage
  }
  return fallback
}

function isFailureBody(body: Record<string, unknown>): boolean {
  return body.status === false || body.success === false
}

function safeRedirectLocation(location?: string): string {
  if (!location) return 'outro endereço'
  try {
    const url = new URL(location)
    return `${url.origin}${url.pathname}`
  } catch {
    return 'outro endereço'
  }
}

function requestTestHost(url: URL, init: RequestInit, timeoutMs: number): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const req = httpsRequest(url, {
      method: init.method ?? 'GET',
      headers,
      // The documented test host currently presents a self-signed certificate.
      // This exception is intentionally scoped to this host only.
      rejectUnauthorized: false,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        const status = response.statusCode ?? 502
        resolve({
          ok: status >= 200 && status < 300,
          status,
          body: parseBody(Buffer.concat(chunks).toString('utf8')),
          location: response.headers.location,
        })
      })
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new FulfillmentApiError('Timeout ao acessar fulfillment', 504))
    })
    req.on('error', reject)
    if (typeof init.body === 'string') req.write(init.body)
    req.end()
  })
}

async function requestApi(
  environment: FulfillmentEnvironment,
  url: URL,
  init: RequestInit,
  timeoutMs: number
): Promise<ApiResponse> {
  if (environment === 'test') return requestTestHost(url, init, timeoutMs)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      body: parseBody(await response.text()),
      location: response.headers.get('location') ?? undefined,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FulfillmentApiError('Timeout ao acessar fulfillment', 504)
    }
    throw new FulfillmentApiError(
      `Falha de conexão com o fulfillment: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      502
    )
  } finally {
    clearTimeout(timeout)
  }
}

function assertUsableResponse(response: ApiResponse, fallback: string): void {
  if (response.status >= 300 && response.status < 400) {
    throw new FulfillmentApiError(
      `O ambiente de fulfillment redirecionou para ${safeRedirectLocation(response.location)}; o endpoint documentado está indisponível.`,
      502,
      response.body
    )
  }
  if (!response.ok || isFailureBody(response.body)) {
    throw new FulfillmentApiError(
      responseMessage(response.body, fallback),
      response.ok ? 422 : response.status,
      response.body
    )
  }
}

export class FulfillmentClient {
  constructor(
    private readonly credentials: FulfillmentCredentials,
    private readonly tokenProvider: (forceRefresh?: boolean) => Promise<string>,
    private readonly timeoutMs = 15000
  ) {}

  static async login(credentials: FulfillmentCredentials): Promise<{ token: string; expiresAt: Date }> {
    const url = new URL('/api/login', BASE_URLS[credentials.environment])
    url.searchParams.set('email', credentials.email)
    url.searchParams.set('password', credentials.password)

    const response = await requestApi(credentials.environment, url, { method: 'POST' }, 15000)
    assertUsableResponse(response, 'Falha ao autenticar no fulfillment')

    const token = String(response.body.access_token ?? response.body.token ?? '')
    if (!token) {
      throw new FulfillmentApiError(
        responseMessage(response.body, 'Resposta de login sem token'),
        502,
        response.body
      )
    }
    return { token, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) }
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    try {
      const token = await this.tokenProvider(!retry)
      const response = await requestApi(this.credentials.environment, new URL(path, BASE_URLS[this.credentials.environment]), {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      }, this.timeoutMs)
      if (response.status === 401 && retry) return this.request<T>(path, init, false)
      assertUsableResponse(response, `Fulfillment respondeu HTTP ${response.status}`)
      return response.body as T
    } catch (error) {
      if (error instanceof FulfillmentApiError) throw error
      if (error instanceof Error && error.message.includes('Timeout')) throw new FulfillmentApiError(error.message, 504)
      throw new FulfillmentApiError(
        `Falha de conexão com o fulfillment: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        502
      )
    }
  }

  getCountries() {
    return this.request<unknown[]>('/api/countries')
  }

  getStock(sku: string) {
    return this.request<Record<string, unknown>>(`/api/products/get-stock/${encodeURIComponent(sku)}`)
  }

  getLeadsPage(country: string, page = 1) {
    const params = new URLSearchParams({ country, page: String(Math.max(1, Math.trunc(page))) })
    return this.request<unknown>(`/api/leads?${params.toString()}`)
  }

  getLeads(country: string) {
    return this.getLeadsPage(country, 1)
  }

  createLead(payload: CreateFulfillmentLead) {
    return this.request<Record<string, unknown>>('/api/leads/store', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        total: String(payload.total),
        items: payload.items.map((item) => ({
          ...item,
          quantity: String(item.quantity),
          total: String(item.total),
        })),
      }),
    })
  }

  getLeadDetails(leadNumber: string) {
    return this.request<Record<string, unknown>>(`/api/leads/details?leadNumber=${encodeURIComponent(leadNumber)}`)
  }

  getLeadHistory(leadNumber: string) {
    return this.request<Record<string, unknown>>(`/api/leads/history?leadNumber=${encodeURIComponent(leadNumber)}`)
  }

  deleteLead(leadNumber: string) {
    return this.request<Record<string, unknown>>(`/api/leads/delete/${encodeURIComponent(leadNumber)}`, {
      method: 'POST',
    })
  }
}

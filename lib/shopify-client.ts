import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_API_VERSION = '2025-10'

export interface ShopifyClientCredentials {
  shopDomain: string
  adminToken: string
  apiVersion?: string
}

export interface ShopifyRequestOptions {
  limit?: number
  updatedAtMin?: string
  createdAtMin?: string
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: unknown
  ) {
    super(message)
    this.name = 'ShopifyApiError'
  }
}

export function normalizeShopDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string | null, webhookSecret: string): boolean {
  if (!hmacHeader || !webhookSecret) return false
  const digest = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('base64')
  const expected = Buffer.from(digest, 'utf8')
  const actual = Buffer.from(hmacHeader, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'))
  if (!match) return null
  const urlMatch = match.match(/<([^>]+)>/)
  if (!urlMatch) return null
  try {
    return new URL(urlMatch[1]).searchParams.get('page_info')
  } catch {
    return null
  }
}

function parseBody(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export class ShopifyClient {
  private readonly shopDomain: string
  private readonly adminToken: string
  private readonly apiVersion: string

  constructor(credentials: ShopifyClientCredentials) {
    this.shopDomain = normalizeShopDomain(credentials.shopDomain)
    this.adminToken = credentials.adminToken
    this.apiVersion = credentials.apiVersion ?? process.env.SHOPIFY_ADMIN_API_VERSION ?? DEFAULT_API_VERSION
  }

  private async requestRaw<T>(
    path: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<{ body: T; response: Response }> {
    const url = new URL(`https://${this.shopDomain}/admin/api/${this.apiVersion}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Shopify-Access-Token': this.adminToken,
      },
    })
    const body = parseBody(await response.text())
    if (!response.ok) {
      throw new ShopifyApiError(`Shopify respondeu HTTP ${response.status}`, response.status, body)
    }
    return { body: body as T, response }
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const { body } = await this.requestRaw<T>(path, params)
    return body
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const url = new URL(`https://${this.shopDomain}/admin/api/${this.apiVersion}${path}`)
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.adminToken,
      },
      body: JSON.stringify(payload),
    })
    const body = parseBody(await response.text())
    if (!response.ok) {
      throw new ShopifyApiError(`Shopify respondeu HTTP ${response.status}`, response.status, body)
    }
    return body as T
  }

  getRecentOrders(options: ShopifyRequestOptions = {}) {
    return this.request<{ orders?: unknown[] }>('/orders.json', {
      status: 'any',
      limit: options.limit ?? 50,
      updated_at_min: options.updatedAtMin,
      created_at_min: options.createdAtMin,
      order: 'updated_at desc',
    })
  }

  getOrderEvents(orderId: string, options: { limit?: number } = {}) {
    if (!/^\d+$/.test(orderId)) throw new Error('Shopify order ID invalido')
    return this.request<{ events?: unknown[] }>(`/orders/${orderId}/events.json`, {
      limit: Math.min(250, Math.max(1, options.limit ?? 100)),
    })
  }

  getProducts(options: ShopifyRequestOptions = {}) {
    return this.request<{ products?: unknown[] }>('/products.json', {
      limit: options.limit ?? 50,
      updated_at_min: options.updatedAtMin,
    })
  }

  // Cursor-based pagination for /products.json — once page_info is used, it
  // cannot be combined with other filters (Shopify Admin REST API rule), so
  // subsequent pages only pass limit + page_info.
  async getProductsPage(options: { limit?: number; pageInfo?: string } = {}): Promise<{
    products: unknown[]
    nextPageInfo: string | null
  }> {
    const params = options.pageInfo
      ? { limit: options.limit ?? 50, page_info: options.pageInfo }
      : { limit: options.limit ?? 50 }
    const { body, response } = await this.requestRaw<{ products?: unknown[] }>('/products.json', params)
    return {
      products: body.products ?? [],
      nextPageInfo: parseNextPageInfo(response.headers.get('Link')),
    }
  }

  getInventoryLevels(inventoryItemIds: string[]) {
    return this.request<{ inventory_levels?: unknown[] }>('/inventory_levels.json', {
      inventory_item_ids: inventoryItemIds.join(','),
    })
  }

  getAbandonedCheckouts(options: ShopifyRequestOptions = {}) {
    return this.request<{ checkouts?: unknown[] }>('/checkouts.json', {
      limit: options.limit ?? 50,
      created_at_min: options.createdAtMin,
      updated_at_min: options.updatedAtMin,
      status: 'open',
    })
  }

  listWebhooks(options: { topic?: string } = {}) {
    return this.request<{ webhooks?: Array<{ id: number; topic: string; address: string }> }>('/webhooks.json', {
      topic: options.topic,
    })
  }

  createWebhook(topic: string, address: string, format: 'json' | 'xml' = 'json') {
    return this.post<{ webhook?: { id: number; topic: string; address: string } }>('/webhooks.json', {
      webhook: { topic, address, format },
    })
  }
}

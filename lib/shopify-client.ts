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

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
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

  getProducts(options: ShopifyRequestOptions = {}) {
    return this.request<{ products?: unknown[] }>('/products.json', {
      limit: options.limit ?? 50,
      updated_at_min: options.updatedAtMin,
    })
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
}

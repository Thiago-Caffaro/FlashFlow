import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const mockLoadShopifyIntegrationForWebhook = jest.fn()
const mockDecodeShopifyWebhookSecret = jest.fn(() => 'webhook-secret')
const mockUpsertShopifyOrder = jest.fn()
const mockUpsertShopifyAbandonedCheckout = jest.fn()
const mockGetSetting = jest.fn(async (_key: string) => 'webhook-secret')

jest.mock('@/lib/shopify-confirmation-service', () => ({
  decodeShopifyWebhookSecret: mockDecodeShopifyWebhookSecret,
  loadShopifyIntegrationForWebhook: mockLoadShopifyIntegrationForWebhook,
  upsertShopifyOrder: mockUpsertShopifyOrder,
  upsertShopifyAbandonedCheckout: mockUpsertShopifyAbandonedCheckout,
}))

// Isola o teste de qualquer cliente Supabase real — app-settings.ts importaria
// lib/supabase-admin.ts (que exige SUPABASE_URL/SERVICE_ROLE_KEY reais) se não mockado.
jest.mock('@/lib/app-settings', () => ({
  getSetting: mockGetSetting,
}))

function hmac(rawBody: string, secret = 'webhook-secret') {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
}

function request(rawBody: string, signature: string) {
  return new NextRequest('http://localhost/api/webhook/shopify/orders', {
    method: 'POST',
    headers: {
      'x-shopify-shop-domain': 'example.myshopify.com',
      'x-shopify-hmac-sha256': signature,
    },
    body: rawBody,
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const orderWebhook = require('@/app/api/webhook/shopify/orders/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const checkoutWebhook = require('@/app/api/webhook/shopify/abandoned-checkouts/route')

describe('Shopify webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadShopifyIntegrationForWebhook.mockResolvedValue({
      id: 'shopify-1',
      shop_domain: 'example.myshopify.com',
    })
    mockUpsertShopifyOrder.mockResolvedValue({ id: 'order-1' })
    mockUpsertShopifyAbandonedCheckout.mockResolvedValue({ id: 'checkout-1' })
  })

  it('rejects order webhooks with invalid HMAC before upserting', async () => {
    const rawBody = JSON.stringify({ id: 123 })
    const response = await orderWebhook.POST(request(rawBody, 'invalid-signature'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false })
    expect(mockUpsertShopifyOrder).not.toHaveBeenCalled()
  })

  it('rejects order webhooks with no HMAC signature header at all', async () => {
    const rawBody = JSON.stringify({ id: 123 })
    const response = await orderWebhook.POST(request(rawBody, ''))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false })
    expect(mockUpsertShopifyOrder).not.toHaveBeenCalled()
  })

  it('rejects order webhooks whose body was tampered with after signing', async () => {
    const originalBody = JSON.stringify({ id: 123, total: '10.00' })
    const validSignature = hmac(originalBody)
    const tamperedBody = JSON.stringify({ id: 123, total: '999999.00' })

    const response = await orderWebhook.POST(request(tamperedBody, validSignature))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false })
    expect(mockUpsertShopifyOrder).not.toHaveBeenCalled()
  })

  it('accepts valid order webhooks and upserts the raw payload', async () => {
    const rawBody = JSON.stringify({ id: 123, name: '#1001' })
    const response = await orderWebhook.POST(request(rawBody, hmac(rawBody)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, order: { id: 'order-1' } })
    expect(mockUpsertShopifyOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shopify-1' }),
      { id: 123, name: '#1001' }
    )
  })

  it('accepts valid abandoned checkout webhooks', async () => {
    const rawBody = JSON.stringify({ id: 987, token: 'cart-token' })
    const response = await checkoutWebhook.POST(request(rawBody, hmac(rawBody)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, checkout: { id: 'checkout-1' } })
    expect(mockUpsertShopifyAbandonedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shopify-1' }),
      { id: 987, token: 'cart-token' }
    )
  })
})

import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const mockLoadShopifyIntegrationForWebhook = jest.fn()
const mockResolveShopifyWebhookSecrets = jest.fn(async () => ['webhook-secret'])
const mockArchiveShopifyOrder = jest.fn()
const mockUpsertShopifyOrder = jest.fn()
const mockUpsertShopifyAbandonedCheckout = jest.fn()
const mockUpsertShopifyDraftOrder = jest.fn()
const mockRemoveShopifyDraftOrder = jest.fn()
const mockGetShopifyTriggersEnabled = jest.fn(async () => true)

jest.mock('@/lib/shopify-confirmation-service', () => ({
  archiveShopifyOrder: mockArchiveShopifyOrder,
  resolveShopifyWebhookSecrets: mockResolveShopifyWebhookSecrets,
  loadShopifyIntegrationForWebhook: mockLoadShopifyIntegrationForWebhook,
  upsertShopifyOrder: mockUpsertShopifyOrder,
  upsertShopifyAbandonedCheckout: mockUpsertShopifyAbandonedCheckout,
  upsertShopifyDraftOrder: mockUpsertShopifyDraftOrder,
  removeShopifyDraftOrder: mockRemoveShopifyDraftOrder,
}))

jest.mock('@/lib/shopify-trigger-settings', () => ({
  getShopifyTriggersEnabled: mockGetShopifyTriggersEnabled,
}))

function hmac(rawBody: string, secret = 'webhook-secret') {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
}

function request(rawBody: string, signature: string, topic?: string) {
  return new NextRequest('http://localhost/api/webhook/shopify/orders', {
    method: 'POST',
    headers: {
      'x-shopify-shop-domain': 'example.myshopify.com',
      'x-shopify-hmac-sha256': signature,
      ...(topic ? { 'x-shopify-topic': topic } : {}),
    },
    body: rawBody,
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const orderWebhook = require('@/app/api/webhook/shopify/orders/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const checkoutWebhook = require('@/app/api/webhook/shopify/abandoned-checkouts/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const draftWebhook = require('@/app/api/webhook/shopify/draft-orders/route')

describe('Shopify webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadShopifyIntegrationForWebhook.mockResolvedValue({
      id: 'shopify-1',
      shop_domain: 'example.myshopify.com',
    })
    mockUpsertShopifyOrder.mockResolvedValue({ id: 'order-1' })
    mockArchiveShopifyOrder.mockResolvedValue({ id: 'order-1' })
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
      { id: 123, name: '#1001' },
      { sendConfirmation: true }
    )
  })

  it('imports a new order without firing Shopify flows when triggers are paused', async () => {
    mockGetShopifyTriggersEnabled.mockResolvedValueOnce(false)
    const rawBody = JSON.stringify({ id: 124, name: '#1002' })

    const response = await orderWebhook.POST(request(rawBody, hmac(rawBody)))

    expect(response.status).toBe(200)
    expect(mockUpsertShopifyOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shopify-1' }),
      { id: 124, name: '#1002' },
      { sendConfirmation: false }
    )
  })

  it.each(['orders/updated', 'orders/paid', 'orders/cancelled'])(
    'updates local lifecycle state for %s without firing a confirmation',
    async (topic) => {
      const rawBody = JSON.stringify({ id: 124, financial_status: 'paid' })

      const response = await orderWebhook.POST(request(rawBody, hmac(rawBody), topic))

      expect(response.status).toBe(200)
      expect(mockUpsertShopifyOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'shopify-1' }),
        { id: 124, financial_status: 'paid' },
        { sendConfirmation: false },
      )
    },
  )

  it('rejects unsupported order topics', async () => {
    const rawBody = JSON.stringify({ id: 124 })
    const response = await orderWebhook.POST(request(rawBody, hmac(rawBody), 'orders/fulfilled'))

    expect(response.status).toBe(400)
    expect(mockUpsertShopifyOrder).not.toHaveBeenCalled()
  })

  it('archives orders/delete webhooks without returning order data', async () => {
    const rawBody = JSON.stringify({ id: 123 })
    const response = await orderWebhook.POST(request(rawBody, hmac(rawBody), 'orders/delete'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, archived: true })
    expect(mockArchiveShopifyOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shopify-1' }),
      { id: 123 },
    )
    expect(mockUpsertShopifyOrder).not.toHaveBeenCalled()
  })

  it('verifies the HMAC with the secret resolved for the store (per-store app)', async () => {
    mockResolveShopifyWebhookSecrets.mockResolvedValueOnce(['store-own-secret'])
    const rawBody = JSON.stringify({ id: 123 })

    const rejected = await orderWebhook.POST(request(rawBody, hmac(rawBody), 'orders/create'))
    expect(rejected.status).toBe(401)

    mockResolveShopifyWebhookSecrets.mockResolvedValueOnce(['store-own-secret'])
    const accepted = await orderWebhook.POST(request(rawBody, hmac(rawBody, 'store-own-secret'), 'orders/create'))
    expect(accepted.status).toBe(200)
    expect(mockResolveShopifyWebhookSecrets).toHaveBeenCalledWith(expect.objectContaining({ id: 'shopify-1' }))
  })

  it('accepts a webhook signed by another of our apps registered on the same store', async () => {
    // Loja conectada antes pelo app global e depois pelo app próprio: os
    // webhooks antigos continuam chegando assinados pelo app global.
    mockResolveShopifyWebhookSecrets.mockResolvedValue(['store-own-secret', 'global-secret'])
    const rawBody = JSON.stringify({ id: 987, token: 'cart-token' })

    const response = await checkoutWebhook.POST(request(rawBody, hmac(rawBody, 'global-secret'), 'checkouts/create'))

    expect(response.status).toBe(200)
    mockResolveShopifyWebhookSecrets.mockResolvedValue(['webhook-secret'])
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

  it('stores draft_orders/create as an abandoned cart (draft source)', async () => {
    mockUpsertShopifyDraftOrder.mockResolvedValue({ id: 'checkout-d1', shopify_name: '#D12', recovery_status: 'Pendente' })
    const rawBody = JSON.stringify({ id: 555, name: '#D12', status: 'open' })

    const response = await draftWebhook.POST(request(rawBody, hmac(rawBody), 'draft_orders/create'))

    expect(response.status).toBe(200)
    expect(mockUpsertShopifyDraftOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 'shopify-1' }), { id: 555, name: '#D12', status: 'open' })
  })

  it('handles draft_orders/delete without upserting', async () => {
    mockRemoveShopifyDraftOrder.mockResolvedValue({ id: 'checkout-d1' })
    const rawBody = JSON.stringify({ id: 555 })

    const response = await draftWebhook.POST(request(rawBody, hmac(rawBody), 'draft_orders/delete'))

    expect(response.status).toBe(200)
    expect(mockRemoveShopifyDraftOrder).toHaveBeenCalled()
    expect(mockUpsertShopifyDraftOrder).not.toHaveBeenCalled()
  })

  it('rejects draft webhooks with invalid HMAC', async () => {
    const rawBody = JSON.stringify({ id: 555 })

    const response = await draftWebhook.POST(request(rawBody, 'invalid', 'draft_orders/update'))

    expect(response.status).toBe(401)
    expect(mockUpsertShopifyDraftOrder).not.toHaveBeenCalled()
  })
})

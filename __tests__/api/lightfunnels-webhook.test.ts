import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const INTEGRATION_ID = '11111111-2222-3333-4444-555555555555'
const mockLoadLightfunnelsIntegration = jest.fn()
const mockGetLightfunnelsAppCredentials = jest.fn(async () => ({ clientId: 'cid', clientSecret: 'app-secret', scopes: 'orders' }))
const mockUpsertLightfunnelsOrder = jest.fn()
const mockSyncProductById = jest.fn()
const mockDeleteProduct = jest.fn()
const mockGetTriggersEnabled = jest.fn(async () => true)
const mockUpdate = jest.fn()

jest.mock('@/lib/lightfunnels-integration-store', () => ({
  loadLightfunnelsIntegration: mockLoadLightfunnelsIntegration,
  getLightfunnelsAppCredentials: mockGetLightfunnelsAppCredentials,
}))

jest.mock('@/lib/lightfunnels-order-service', () => {
  const actual = jest.requireActual('@/lib/lightfunnels-order-service')
  return {
    unwrapLightfunnelsNode: actual.unwrapLightfunnelsNode,
    upsertLightfunnelsOrder: mockUpsertLightfunnelsOrder,
  }
})

jest.mock('@/lib/lightfunnels-products-service', () => ({
  syncLightfunnelsProductById: mockSyncProductById,
  deleteLightfunnelsProductByLfId: mockDeleteProduct,
}))

jest.mock('@/lib/lightfunnels-trigger-settings', () => ({
  getLightfunnelsTriggersEnabled: mockGetTriggersEnabled,
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => {
      const builder = {
        update: (patch: unknown) => {
          mockUpdate(patch)
          return builder
        },
        eq: () => Promise.resolve({ data: null, error: null }),
      }
      return builder
    }),
  },
}))

function sign(rawBody: string, secret = 'app-secret') {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
}

function request(rawBody: string, signature: string, event = 'order/confirmed', integration = INTEGRATION_ID) {
  const params = new URLSearchParams({ integration, event })
  return new NextRequest(`http://localhost/api/webhook/lightfunnels?${params.toString()}`, {
    method: 'POST',
    headers: { 'lightfunnels-hmac': signature },
    body: rawBody,
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webhook = require('@/app/api/webhook/lightfunnels/route')

const integration = { id: INTEGRATION_ID, active: true, lf_account_id: 'acc-1', default_country: 'SPAIN' }

describe('Lightfunnels webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadLightfunnelsIntegration.mockResolvedValue(integration)
    mockUpsertLightfunnelsOrder.mockResolvedValue({ id: 'order-1' })
    mockGetTriggersEnabled.mockResolvedValue(true)
  })

  it('rejects an invalid HMAC before touching the order', async () => {
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    const response = await webhook.POST(request(rawBody, 'bad-signature'))
    expect(response.status).toBe(401)
    expect(mockUpsertLightfunnelsOrder).not.toHaveBeenCalled()
  })

  it('rejects a body tampered with after signing', async () => {
    const signature = sign(JSON.stringify({ node: { id: 'o1', total: 10 } }))
    const response = await webhook.POST(request(JSON.stringify({ node: { id: 'o1', total: 999 } }), signature))
    expect(response.status).toBe(401)
  })

  it('accepts a signature computed over re-serialized JSON (doc example)', async () => {
    const pretty = JSON.stringify({ node: { id: 'o1' } }, null, 2)
    const signature = sign(JSON.stringify(JSON.parse(pretty)))
    const response = await webhook.POST(request(pretty, signature))
    expect(response.status).toBe(200)
  })

  it('returns 404 for an unknown or inactive integration', async () => {
    mockLoadLightfunnelsIntegration.mockResolvedValue({ ...integration, active: false })
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody)))
    expect(response.status).toBe(404)
  })

  it('rejects a malformed integration id without querying', async () => {
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody), 'order/confirmed', 'not-a-uuid'))
    expect(response.status).toBe(400)
    expect(mockLoadLightfunnelsIntegration).not.toHaveBeenCalled()
  })

  it('order/confirmed upserts and asks for the confirmation trigger', async () => {
    const rawBody = JSON.stringify({ node: { id: 'o1', funnel_id: 'f1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody)))
    expect(response.status).toBe(200)
    expect(mockUpsertLightfunnelsOrder).toHaveBeenCalledWith(
      integration,
      expect.objectContaining({ id: 'o1', funnel_id: 'f1' }),
      { sendConfirmation: true },
    )
  })

  it('order/confirmed does not trigger flows while Lightfunnels triggers are paused', async () => {
    mockGetTriggersEnabled.mockResolvedValue(false)
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    await webhook.POST(request(rawBody, sign(rawBody)))
    expect(mockUpsertLightfunnelsOrder).toHaveBeenCalledWith(integration, expect.anything(), { sendConfirmation: false })
  })

  it('order/updated only updates the order', async () => {
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    await webhook.POST(request(rawBody, sign(rawBody), 'order/updated'))
    expect(mockUpsertLightfunnelsOrder).toHaveBeenCalledWith(integration, expect.anything(), { sendConfirmation: false })
  })

  it('product/updated resyncs the product from the API', async () => {
    const rawBody = JSON.stringify({ node: { id: 'p1', title: 'X' } })
    await webhook.POST(request(rawBody, sign(rawBody), 'product/updated'))
    expect(mockSyncProductById).toHaveBeenCalledWith(integration, 'p1')
  })

  it('app/uninstalled deactivates the integration', async () => {
    const rawBody = JSON.stringify({ node: { id: 'acc-1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody), 'app/uninstalled'))
    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ active: false, oauth_connected: false }))
  })

  it('rejects unsupported events', async () => {
    const rawBody = JSON.stringify({ node: { id: 'c1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody), 'checkout/created'))
    expect(response.status).toBe(400)
  })

  it('returns 500 when processing fails so Lightfunnels can retry', async () => {
    mockUpsertLightfunnelsOrder.mockRejectedValue(new Error('db down'))
    const rawBody = JSON.stringify({ node: { id: 'o1' } })
    const response = await webhook.POST(request(rawBody, sign(rawBody)))
    expect(response.status).toBe(500)
  })
})

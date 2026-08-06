import { NextRequest } from 'next/server'

const mockFrom = jest.fn()
const mockSyncIntegration = jest.fn()

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/fulfillment-delivery-sync', () => ({
  syncFulfillmentDeliveryIntegration: mockSyncIntegration,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mappingRoute = require('@/app/api/fulfillment/delivery-status-mappings/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const syncRoute = require('@/app/api/fulfillment/integrations/[id]/delivery-sync/route')

function request(method: string, url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? { method } : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('fulfillment delivery sync APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('normalizes an external status key before updating its mapping', async () => {
    const update = jest.fn()
    const eq = jest.fn()
    const select = jest.fn()
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { external_status_key: 'em-transito', delivery_status: 'A caminho' },
      error: null,
    })
    update.mockReturnValue({ eq })
    eq.mockReturnValue({ select })
    select.mockReturnValue({ maybeSingle })
    mockFrom.mockReturnValue({ update })

    const response = await mappingRoute.PUT(request(
      'PUT',
      'http://localhost/api/fulfillment/delivery-status-mappings',
      { external_status_key: '  Em TrAnsito ', delivery_status: 'A caminho' }
    ))

    expect(response.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('external_status_key', 'em transito')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ delivery_status: 'A caminho' }))
  })

  it('rejects an invalid internal delivery status', async () => {
    const response = await mappingRoute.PUT(request(
      'PUT',
      'http://localhost/api/fulfillment/delivery-status-mappings',
      { external_status_key: 'em-transito', delivery_status: 'Estado inventado' }
    ))

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('runs a manual sync for the requested integration', async () => {
    mockSyncIntegration.mockResolvedValue({ scanned: 8, updated: 2, unknown: 1, failed: 0 })

    const response = await syncRoute.POST(
      request('POST', 'http://localhost/api/fulfillment/integrations/integration-1/delivery-sync'),
      { params: Promise.resolve({ id: 'integration-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSyncIntegration).toHaveBeenCalledWith('integration-1')
    expect(body.stats).toMatchObject({ scanned: 8, updated: 2 })
  })

  it('reports a locked integration as a conflict', async () => {
    mockSyncIntegration.mockRejectedValue(new Error('Sincronizacao ocupada por outro worker'))

    const response = await syncRoute.POST(
      request('POST', 'http://localhost/api/fulfillment/integrations/integration-1/delivery-sync'),
      { params: Promise.resolve({ id: 'integration-1' }) }
    )

    expect(response.status).toBe(409)
  })
})

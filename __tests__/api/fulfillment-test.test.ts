import { NextRequest } from 'next/server'

const safeClient = {
  getCountries: jest.fn(),
  getStock: jest.fn(),
  createLead: jest.fn(),
  deleteLead: jest.fn(),
}

const getFulfillmentClient = jest.fn(async (_country: string) => safeClient)

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/fulfillment-service', () => ({
  getFulfillmentClient: (country: string) => getFulfillmentClient(country),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/fulfillment/test/route')

function request(body: unknown) {
  return new NextRequest('http://localhost/api/fulfillment/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/fulfillment/test', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    safeClient.getCountries.mockResolvedValue({ countries: [] })
    safeClient.getStock.mockResolvedValue({ remaining_stock: 10 })
  })

  it('runs connection checks through a read-only countries request', async () => {
    const response = await POST(request({ action: 'connection', country: 'PORTUGAL' }))

    expect(response.status).toBe(200)
    expect(safeClient.getCountries).toHaveBeenCalledTimes(1)
    expect(safeClient.getStock).not.toHaveBeenCalled()
    expect(safeClient.createLead).not.toHaveBeenCalled()
    expect(safeClient.deleteLead).not.toHaveBeenCalled()
  })

  it('allows stock checks without calling order write methods', async () => {
    const response = await POST(request({ action: 'stock', country: 'PORTUGAL', sku: 'SKU-1,3' }))

    expect(response.status).toBe(200)
    expect(safeClient.getStock).toHaveBeenCalledWith('SKU-1')
    expect(safeClient.createLead).not.toHaveBeenCalled()
    expect(safeClient.deleteLead).not.toHaveBeenCalled()
  })

  it('rejects write-like or unknown actions', async () => {
    const response = await POST(request({ action: 'deleteLead', country: 'PORTUGAL' }))

    expect(response.status).toBe(400)
    expect(getFulfillmentClient).not.toHaveBeenCalled()
    expect(safeClient.createLead).not.toHaveBeenCalled()
    expect(safeClient.deleteLead).not.toHaveBeenCalled()
  })
})

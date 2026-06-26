import { NextRequest } from 'next/server'

const listExternalFulfillmentLeads = jest.fn()

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/fulfillment-service', () => ({
  listExternalFulfillmentLeads: (country: string) => listExternalFulfillmentLeads(country),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/fulfillment/external-leads/route')

function request(url: string) {
  return new NextRequest(url)
}

describe('GET /api/fulfillment/external-leads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    listExternalFulfillmentLeads.mockResolvedValue([
      { source: 'fenixcod', lead_number: 'PD-1', country: 'PORTUGAL' },
    ])
  })

  it('requires a country', async () => {
    const response = await GET(request('http://localhost/api/fulfillment/external-leads'))

    expect(response.status).toBe(400)
    expect(listExternalFulfillmentLeads).not.toHaveBeenCalled()
  })

  it('returns read-only external leads for the selected country', async () => {
    const response = await GET(request('http://localhost/api/fulfillment/external-leads?country=portugal'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listExternalFulfillmentLeads).toHaveBeenCalledWith('PORTUGAL')
    expect(body).toMatchObject({
      ok: true,
      country: 'PORTUGAL',
      leads: [{ lead_number: 'PD-1' }],
    })
  })
})

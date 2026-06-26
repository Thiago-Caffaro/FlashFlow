import { FulfillmentClient, FulfillmentCredentials } from '@/lib/fulfillment-client'

const credentials: FulfillmentCredentials = {
  email: 'test@example.com',
  password: 'secret',
  environment: 'production',
}

describe('FulfillmentClient', () => {
  const fetchMock = jest.fn()

  function mockResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: jest.fn().mockResolvedValue(JSON.stringify(body)),
      headers: new Headers(),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock
  })

  it('authenticates without exposing credentials in request body', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { status: true, token: 'token-1', type: 'Bearer Token' }))

    const result = await FulfillmentClient.login(credentials)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toContain('api.ecomfulfilment.eu/api/login')
    expect(String(url)).toContain('email=test%40example.com')
    expect(init.body).toBeUndefined()
    expect(result.token).toBe('token-1')
  })

  it('uses bearer token and serializes lead payload', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { success: true, lead_number: 'PD-1' }))
    const client = new FulfillmentClient(credentials, async () => 'token-1')
    await client.createLead({
      name_costumer: 'Client',
      mobile: '+351900000000',
      province: 'Lisboa',
      zipcod: '1000-001',
      city: 'Lisboa',
      address: 'Rua A',
      total: 20,
      payment_type: 'COD',
      country: 'PORTUGAL',
      order_number: 'FF-1',
      items: [{ sku: 'SKU-1', quantity: 1, total: 20 }],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-1')
    const payload = JSON.parse(init.body)
    expect(payload.zipcod).toBe('1000-001')
    expect(payload.total).toBe('20')
    expect(payload.items[0]).toMatchObject({ quantity: '1', total: '20' })
  })

  it('forces token refresh once after 401', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, {}))
      .mockResolvedValueOnce(mockResponse(200, { stock: 10 }))
    const provider = jest.fn(async (force?: boolean) => force ? 'token-2' : 'token-1')
    const client = new FulfillmentClient(credentials, provider)

    await client.getStock('SKU-1')

    expect(provider).toHaveBeenNthCalledWith(1, false)
    expect(provider).toHaveBeenNthCalledWith(2, true)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-2')
  })

  it('lists leads with a read-only GET request', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { data: [] }))
    const client = new FulfillmentClient(credentials, async () => 'token-1')

    await client.getLeads('PORTUGAL')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/leads?country=PORTUGAL')
    expect(init.method).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(init.headers.Authorization).toBe('Bearer token-1')
  })

  it('surfaces the API message when login returns status false with HTTP 200', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { status: false, message: 'Invalid email or password' }))

    await expect(FulfillmentClient.login(credentials)).rejects.toMatchObject({
      message: 'Invalid email or password',
      status: 422,
    })
  })
})

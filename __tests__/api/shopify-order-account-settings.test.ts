import { NextRequest } from 'next/server'

const isAdminRequestMock = jest.fn(() => true)
const getDefaultMock = jest.fn()
const setDefaultMock = jest.fn()

jest.mock('@/lib/server-auth', () => ({ isAdminRequest: isAdminRequestMock }))
jest.mock('@/lib/shopify-order-settings', () => ({
  getDefaultShopifyOrderInstance: getDefaultMock,
  setDefaultShopifyOrderInstance: setDefaultMock,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, PUT } = require('@/app/api/settings/shopify-order-account/route')

function request(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest('http://localhost/api/settings/shopify-order-account', init)
}

describe('Shopify default order account settings API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isAdminRequestMock.mockReturnValue(true)
    getDefaultMock.mockResolvedValue('wa-default')
    setDefaultMock.mockImplementation(async (value: string | null) => value)
  })

  it('returns the configured account to an admin', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, instanceName: 'wa-default' })
  })

  it('saves or clears the configured account', async () => {
    const saveResponse = await PUT(request({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: 'wa-1' }),
    }))
    const clearResponse = await PUT(request({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: null }),
    }))

    expect(saveResponse.status).toBe(200)
    expect(clearResponse.status).toBe(200)
    expect(setDefaultMock).toHaveBeenNthCalledWith(1, 'wa-1')
    expect(setDefaultMock).toHaveBeenNthCalledWith(2, null)
  })

  it('rejects unauthenticated requests', async () => {
    isAdminRequestMock.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(getDefaultMock).not.toHaveBeenCalled()
  })
})

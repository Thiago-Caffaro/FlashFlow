import { NextRequest } from 'next/server'

const isAdminRequestMock = jest.fn(() => true)
const setKeepLocalCopiesMock = jest.fn()

jest.mock('@/lib/server-auth', () => ({ isAdminRequest: isAdminRequestMock }))
jest.mock('@/lib/shopify-products-service', () => ({
  hideShopifyProduct: jest.fn(),
  setKeepLocalCopy: jest.fn(),
  setKeepLocalCopies: setKeepLocalCopiesMock,
}))
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT } = require('@/app/api/fulfillment/shopify/products/route')

function request(body: unknown) {
  return new NextRequest('http://localhost/api/fulfillment/shopify/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Shopify products bulk API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isAdminRequestMock.mockReturnValue(true)
    setKeepLocalCopiesMock.mockResolvedValue(3)
  })

  it('updates local copies in one authenticated bulk operation', async () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    const response = await PUT(request({ ids, keep_local_copy: true }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ ok: true, updated: 3 })
    expect(setKeepLocalCopiesMock).toHaveBeenCalledWith(ids, true)
  })

  it('rejects malformed product ids', async () => {
    const response = await PUT(request({ ids: ['a', 2], keep_local_copy: false }))
    expect(response.status).toBe(400)
    expect(setKeepLocalCopiesMock).not.toHaveBeenCalled()
  })
})

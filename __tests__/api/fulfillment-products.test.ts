import { NextRequest } from 'next/server'

const mockFrom = jest.fn()

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryBuilder = {
  updates: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  single: jest.Mock<Promise<QueryResult>, []>
  maybeSingle: jest.Mock<Promise<QueryResult>, []>
  update: jest.Mock<QueryBuilder, [unknown]>
  insert: jest.Mock<QueryBuilder, [unknown]>
  order: jest.Mock<QueryBuilder, [string, unknown?]>
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

function queryBuilder(result: QueryResult = { data: null, error: null }) {
  const updates: unknown[] = []
  let builder: QueryBuilder
  builder = {
    updates,
    select: jest.fn((_columns?: string) => builder),
    eq: jest.fn((_column: string, _value: unknown) => builder),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
    update: jest.fn((payload: unknown) => {
      updates.push(payload)
      return builder
    }),
    insert: jest.fn((_payload: unknown) => builder),
    order: jest.fn((_column: string, _options?: unknown) => builder),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function request(url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? undefined : {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT, DELETE } = require('@/app/api/fulfillment/products/route')

describe('/api/fulfillment/products writes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('validates product price on update', async () => {
    const response = await PUT(request('http://localhost/api/fulfillment/products', {
      id: 'product-1',
      price: -1,
    }))

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('reactivates a product through PUT without requiring all fields', async () => {
    const product = { id: 'product-1', active: true }
    const mirrorBuilder = queryBuilder({ data: null, error: null })
    const productBuilder = queryBuilder({ data: product, error: null })
    mockFrom.mockImplementation((table: string) => (table === 'shopify_products' || table === 'lightfunnels_products' ? mirrorBuilder : productBuilder))

    const response = await PUT(request('http://localhost/api/fulfillment/products', {
      id: 'product-1',
      active: true,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(productBuilder.updates[0]).toMatchObject({ active: true })
    expect(body).toMatchObject({ ok: true, product })
  })

  it('rejects PUT that tries to change the product country', async () => {
    const builder = queryBuilder({ data: { id: 'product-1', country: 'PT' }, error: null })
    mockFrom.mockReturnValue(builder)

    const response = await PUT(request('http://localhost/api/fulfillment/products', {
      id: 'product-1',
      country: 'ES',
      name: 'Produto',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(builder.updates.length).toBe(0)
  })

  it('allows PUT that resends the same (unchanged) country', async () => {
    const builder = queryBuilder({ data: { id: 'product-1', country: 'PT', name: 'Produto' }, error: null })
    const mirrorBuilder = queryBuilder({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => (table === 'shopify_products' || table === 'lightfunnels_products' ? mirrorBuilder : builder))

    const response = await PUT(request('http://localhost/api/fulfillment/products', {
      id: 'product-1',
      country: 'PT',
      name: 'Produto novo',
    }))

    expect(response.status).toBe(200)
  })

  it('soft deletes a product by setting active=false', async () => {
    const product = { id: 'product-1', active: false }
    const builder = queryBuilder({ data: product, error: null })
    const mirrorBuilder = queryBuilder({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => (table === 'shopify_products' || table === 'lightfunnels_products' ? mirrorBuilder : builder))

    const response = await DELETE(new NextRequest('http://localhost/api/fulfillment/products?id=product-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(builder.updates[0]).toMatchObject({ active: false })
    expect(body).toMatchObject({ ok: true, product })
  })

  it('rejects deleting a local product mirrored from Shopify', async () => {
    const mirrorBuilder = queryBuilder({ data: { id: 'shopify-product-1' }, error: null })
    const productBuilder = queryBuilder({ data: { id: 'product-1' }, error: null })
    mockFrom.mockImplementation((table: string) => (table === 'shopify_products' || table === 'lightfunnels_products' ? mirrorBuilder : productBuilder))

    const response = await DELETE(new NextRequest('http://localhost/api/fulfillment/products?id=product-1'))

    expect(response.status).toBe(409)
    expect(productBuilder.updates).toHaveLength(0)
  })

  it('fails closed when the Shopify mirror lookup fails during deletion', async () => {
    const mirrorBuilder = queryBuilder({ data: null, error: { message: 'mirror lookup failed' } })
    const productBuilder = queryBuilder({ data: { id: 'product-1' }, error: null })
    mockFrom.mockImplementation((table: string) => (table === 'shopify_products' || table === 'lightfunnels_products' ? mirrorBuilder : productBuilder))

    const response = await DELETE(new NextRequest('http://localhost/api/fulfillment/products?id=product-1'))

    expect(response.status).toBe(500)
    expect(productBuilder.updates).toHaveLength(0)
  })
})

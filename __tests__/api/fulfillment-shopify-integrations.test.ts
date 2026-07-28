import { NextRequest } from 'next/server'

const mockFrom = jest.fn()

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/ai-crypto', () => ({
  encryptSecret: jest.fn(() => ({ encrypted_key: 'enc', iv: 'iv', auth_tag: 'tag' })),
}))

jest.mock('@/lib/shopify-confirmation-service', () => ({
  SHOPIFY_INTEGRATION_PUBLIC_SELECT: 'id, shop_domain, default_country',
}))

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryBuilder = {
  updates: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  single: jest.Mock<Promise<QueryResult>, []>
  update: jest.Mock<QueryBuilder, [unknown]>
}

function queryBuilder(result: QueryResult): QueryBuilder {
  const updates: unknown[] = []
  let builder: QueryBuilder
  builder = {
    updates,
    select: jest.fn((_columns?: string) => builder),
    eq: jest.fn((_column: string, _value: unknown) => builder),
    single: jest.fn(async () => result),
    update: jest.fn((payload: unknown) => {
      updates.push(payload)
      return builder
    }),
  }
  return builder
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/fulfillment/shopify/integrations', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT } = require('@/app/api/fulfillment/shopify/integrations/route')

beforeEach(() => jest.clearAllMocks())

describe('PUT /api/fulfillment/shopify/integrations — domínio imutável', () => {
  it('rejeita tentativa de trocar o shop_domain de uma integração existente', async () => {
    const builder = queryBuilder({ data: { id: 'int-1', shop_domain: 'loja-a.myshopify.com' }, error: null })
    mockFrom.mockReturnValue(builder)

    const res = await PUT(putRequest({ id: 'int-1', shop_domain: 'loja-b.myshopify.com' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(builder.updates.length).toBe(0)
  })

  it('permite reenviar o mesmo shop_domain sem alteração', async () => {
    const builder = queryBuilder({ data: { id: 'int-1', shop_domain: 'loja-a.myshopify.com' }, error: null })
    mockFrom.mockReturnValue(builder)

    const res = await PUT(putRequest({ id: 'int-1', shop_domain: 'loja-a.myshopify.com', shop_name: 'Loja A' }))
    expect(res.status).toBe(200)
  })

  it('retorna 404 quando a integração não existe', async () => {
    const builder = queryBuilder({ data: null, error: { message: 'not found' } })
    mockFrom.mockReturnValue(builder)

    const res = await PUT(putRequest({ id: 'inexistente', shop_name: 'X' }))
    expect(res.status).toBe(404)
  })
})

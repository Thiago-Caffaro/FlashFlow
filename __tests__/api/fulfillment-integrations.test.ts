import { NextRequest } from 'next/server'

const mockFrom = jest.fn()
const mockLogin = jest.fn()
const mockEncryptSecret = jest.fn(() => ({
  encrypted_key: 'encrypted',
  iv: 'iv',
  auth_tag: 'tag',
}))

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: jest.fn(() => true),
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/ai-crypto', () => ({
  encryptSecret: mockEncryptSecret,
}))

jest.mock('@/lib/fulfillment-client', () => {
  class MockFulfillmentApiError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message)
      this.name = 'FulfillmentApiError'
    }
  }
  return {
    FulfillmentApiError: MockFulfillmentApiError,
    FulfillmentClient: { login: mockLogin },
  }
})

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryBuilder = {
  updates: unknown[]
  inserts: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  single: jest.Mock<Promise<QueryResult>, []>
  insert: jest.Mock<QueryBuilder, [unknown]>
  update: jest.Mock<QueryBuilder, [unknown]>
  order: jest.Mock<QueryBuilder, [string, unknown?]>
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

function queryBuilder(result: QueryResult = { data: null, error: null }) {
  const updates: unknown[] = []
  const inserts: unknown[] = []
  let builder: QueryBuilder
  builder = {
    updates,
    inserts,
    select: jest.fn((_columns?: string) => builder),
    eq: jest.fn((_column: string, _value: unknown) => builder),
    single: jest.fn(async () => result),
    insert: jest.fn((payload: unknown) => {
      inserts.push(payload)
      return builder
    }),
    update: jest.fn((payload: unknown) => {
      updates.push(payload)
      return builder
    }),
    order: jest.fn((_column: string, _options?: unknown) => builder),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function request(method: string, url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? { method } : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST, DELETE } = require('@/app/api/fulfillment/integrations/route')

describe('/api/fulfillment/integrations writes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLogin.mockResolvedValue({ token: 'token-1', expiresAt: new Date('2026-06-16T12:00:00.000Z') })
  })

  it('rejects the documented test environment without calling FenixCOD login', async () => {
    const response = await POST(request('POST', 'http://localhost/api/fulfillment/integrations', {
      country: 'PORTUGAL',
      email: 'ops@example.com',
      password: 'secret',
      environment: 'test',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('teste documentado')
    expect(mockLogin).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('soft deactivates an integration by setting active=false', async () => {
    const integration = { id: 'integration-1', active: false }
    const builder = queryBuilder({ data: integration, error: null })
    mockFrom.mockReturnValue(builder)

    const response = await DELETE(request('DELETE', 'http://localhost/api/fulfillment/integrations?id=integration-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(builder.updates[0]).toMatchObject({ active: false })
    expect(body).toMatchObject({ ok: true, integration })
  })
})

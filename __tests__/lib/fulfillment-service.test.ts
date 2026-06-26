export {}

const mockFrom = jest.fn()
const mockCreateLead = jest.fn()
const mockLogin = jest.fn()
const mockDecryptSecret = jest.fn(() => 'decoded-secret')
const mockEncryptSecret = jest.fn(() => ({
  encrypted_key: 'encrypted-token',
  iv: 'iv',
  auth_tag: 'tag',
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/ai-crypto', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
}))

jest.mock('@/lib/fulfillment-client', () => {
  class MockFulfillmentApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly response?: unknown
    ) {
      super(message)
      this.name = 'FulfillmentApiError'
    }
  }

  const MockFulfillmentClient = jest.fn().mockImplementation(() => ({
    createLead: mockCreateLead,
  }))
  Object.assign(MockFulfillmentClient, { login: mockLogin })

  return {
    FulfillmentClient: MockFulfillmentClient,
    FulfillmentApiError: MockFulfillmentApiError,
  }
})

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryBuilder = {
  inserts: unknown[]
  updates: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  is: jest.Mock<QueryBuilder, [string, unknown]>
  in: jest.Mock<QueryBuilder, [string, unknown[]]>
  order: jest.Mock<QueryBuilder, [string, unknown?]>
  limit: jest.Mock<QueryBuilder, [number]>
  maybeSingle: jest.Mock<Promise<QueryResult>, []>
  single: jest.Mock<Promise<QueryResult>, []>
  insert: jest.Mock<QueryBuilder, [unknown]>
  update: jest.Mock<QueryBuilder, [unknown]>
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

function queryBuilder(result: QueryResult = { data: null, error: null }) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  let builder: QueryBuilder
  builder = {
    inserts,
    updates,
    select: jest.fn((_columns?: string) => builder),
    eq: jest.fn((_column: string, _value: unknown) => builder),
    is: jest.fn((_column: string, _value: unknown) => builder),
    in: jest.fn((_column: string, _values: unknown[]) => builder),
    order: jest.fn((_column: string, _options?: unknown) => builder),
    limit: jest.fn((_count: number) => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    insert: jest.fn((payload: unknown) => {
      inserts.push(payload)
      return builder
    }),
    update: jest.fn((payload: unknown) => {
      updates.push(payload)
      return builder
    }),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function setTableQueues(queues: Record<string, ReturnType<typeof queryBuilder>[]>) {
  const remaining = new Map(Object.entries(queues))
  mockFrom.mockImplementation((table: string) => {
    const queue = remaining.get(table)
    if (!queue?.length) throw new Error(`Unexpected table ${table}`)
    return queue.shift()
  })
}

function integrationRow() {
  return {
    country: 'PORTUGAL',
    environment: 'production',
    encrypted_email: 'email',
    email_iv: 'iv',
    email_auth_tag: 'tag',
    encrypted_password: 'password',
    password_iv: 'iv',
    password_auth_tag: 'tag',
    encrypted_token: null,
    token_iv: null,
    token_auth_tag: null,
    token_expires_at: null,
  }
}

function localOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 'FF-1',
    lead_number: null,
    instance_name: 'wa-1',
    country: 'PORTUGAL',
    conversation_id: 'conversation-1',
    contact_phone: '+351900000000',
    customer_name: 'Client',
    email: null,
    address: 'Rua A',
    city: 'Lisboa',
    province: 'Lisboa',
    zipcode: '1000-001',
    payment_type: 'COD',
    items: [{ product_id: 'product-1', sku: 'SKU-1', name: 'Product', quantity: 1, unit_price: 20, total: 20 }],
    total: 20,
    currency: 'EUR',
    status: 'pending_operator',
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  createFulfillmentOrder,
  submitFulfillmentOrder,
} = require('@/lib/fulfillment-service')

describe('fulfillment-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateLead.mockResolvedValue({ success: true, lead_number: 'PD-1' })
  })

  it('creates a pending local order without calling FenixCOD', async () => {
    const account = queryBuilder({ data: { country: 'PORTUGAL' }, error: null })
    const products = queryBuilder({
      data: [{ id: 'product-1', sku: 'SKU-1', name: 'Product', price: 20, currency: 'EUR', active: true }],
      error: null,
    })
    const insertedOrder = queryBuilder({ data: localOrder(), error: null })
    const event = queryBuilder()
    setTableQueues({
      accounts: [account],
      fulfillment_products: [products],
      fulfillment_orders: [insertedOrder],
      fulfillment_order_events: [event],
    })

    const order = await createFulfillmentOrder({
      instanceName: 'wa-1',
      conversationId: 'conversation-1',
      customerName: 'Client',
      contactPhone: '+351900000000',
      email: null,
      address: 'Rua A',
      city: 'Lisboa',
      province: 'Lisboa',
      zipcode: '1000-001',
      paymentType: 'COD',
      items: [{ productId: 'product-1', quantity: 1 }],
    })

    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(insertedOrder.inserts[0]).toMatchObject({ status: 'pending_operator' })
    expect(event.inserts[0]).toMatchObject({ event_type: 'pending_operator' })
    expect(order).toMatchObject({ id: 'order-1', status: 'pending_operator' })
  })

  it('submits a pending local order once and stores the returned lead number', async () => {
    const lockedOrder = queryBuilder({ data: localOrder({ status: 'submitting' }), error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1' }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      fulfillment_integrations: [integration],
    })

    const order = await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledTimes(1)
    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      order_number: 'FF-1',
      country: 'PORTUGAL',
      items: [{ sku: 'SKU-1', quantity: 1, total: 20 }],
    }))
    expect(updatedOrder.updates[0]).toMatchObject({ lead_number: 'PD-1', status: 'created', send_status: 'Enviado' })
    expect(eventCreated.inserts[0]).toMatchObject({ event_type: 'created' })
    expect(order).toMatchObject({ status: 'created', lead_number: 'PD-1' })
  })

  it('marks timeout submissions as unknown without a retry loop', async () => {
    mockCreateLead.mockRejectedValue(new Error('Timeout ao acessar fulfillment'))
    const lockedOrder = queryBuilder({ data: localOrder({ status: 'submitting' }), error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const unknownOrder = queryBuilder({ data: localOrder({ status: 'unknown' }), error: null })
    const eventUnknown = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, unknownOrder],
      fulfillment_order_events: [eventSubmitting, eventUnknown],
      fulfillment_integrations: [integration],
    })

    await expect(submitFulfillmentOrder('order-1')).rejects.toMatchObject({
      submissionStatus: 'unknown',
    })

    expect(mockCreateLead).toHaveBeenCalledTimes(1)
    expect(unknownOrder.updates[0]).toMatchObject({ status: 'unknown', send_status: 'Pendente' })
    expect(eventUnknown.inserts[0]).toMatchObject({ event_type: 'unknown' })
  })

  it('does not submit simulation orders to FenixCOD', async () => {
    const lockMiss = queryBuilder({ data: null, error: { message: 'No rows' } })
    const currentOrder = queryBuilder({
      data: localOrder({ is_simulation: true }),
      error: null,
    })
    setTableQueues({
      fulfillment_orders: [lockMiss, currentOrder],
    })

    await expect(submitFulfillmentOrder('order-1')).rejects.toThrow('simulação')

    expect(mockCreateLead).not.toHaveBeenCalled()
  })
})

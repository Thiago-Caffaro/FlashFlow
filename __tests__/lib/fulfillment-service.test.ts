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

  it('recalculates a zero stored order total from its items before creating the lead', async () => {
    const orderWithWrongTotal = localOrder({
      status: 'submitting',
      total: 0,
      items: [{ product_id: 'product-1', sku: 'SKU-1', name: 'Product', quantity: 1, unit_price: 49.9, total: 49.9 }],
    })
    const lockedOrder = queryBuilder({ data: orderWithWrongTotal, error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1', total: 49.9 }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      fulfillment_integrations: [integration],
    })

    await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      total: 49.9,
      items: [{ sku: 'SKU-1', quantity: 1, total: 49.9 }],
    }))
    expect(updatedOrder.updates[0]).toMatchObject({ total: 49.9 })
  })

  it('sends a zeroed total to FenixCOD for an order already paid on Shopify, but keeps the real total stored', async () => {
    const paidOrder = localOrder({ status: 'submitting', shopify_financial_status: 'paid' })
    const lockedOrder = queryBuilder({ data: paidOrder, error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1' }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      fulfillment_integrations: [integration],
    })

    await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      total: 0,
      items: [{ sku: 'SKU-1', quantity: 1, total: 0 }],
    }))
    // O valor real (20) continua sendo o que fica gravado/exibido — só o
    // payload enviado ao FenixCOD é zerado, não o registro do pedido.
    expect(updatedOrder.updates[0]).toMatchObject({ total: 20 })
  })

  it('sends the real total to FenixCOD when the Shopify order is not yet paid', async () => {
    const pendingOrder = localOrder({ status: 'submitting', shopify_financial_status: 'pending' })
    const lockedOrder = queryBuilder({ data: pendingOrder, error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1' }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      fulfillment_integrations: [integration],
    })

    await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      total: 20,
      items: [{ sku: 'SKU-1', quantity: 1, total: 20 }],
    }))
  })

  it('resolves the latest Shopify catalog SKU before submitting an existing order', async () => {
    const shopifyOrder = localOrder({
      status: 'submitting',
      source: 'shopify',
      shopify_integration_id: 'shopify-1',
      raw_shopify_payload: {
        line_items: [{
          product_id: 15268755505500,
          variant_id: 55776453460316,
          sku: null,
          name: 'CAFFEINE',
        }],
      },
      items: [{
        product_id: '15268755505500',
        sku: '55776453460316',
        name: 'CAFFEINE',
        quantity: 1,
        unit_price: 20,
        total: 20,
      }],
    })
    const lockedOrder = queryBuilder({ data: shopifyOrder, error: null })
    const eventSubmitting = queryBuilder()
    const catalog = queryBuilder({
      data: [{ shopify_variant_id: '55776453460316', sku: 'FENIX-CAFFEINE' }],
      error: null,
    })
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1' }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      shopify_products: [catalog],
      fulfillment_integrations: [integration],
    })

    await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ sku: 'FENIX-CAFFEINE', quantity: 1, total: 20 }],
    }))
    expect(updatedOrder.updates[0]).toMatchObject({
      items: [expect.objectContaining({
        product_id: '55776453460316',
        shopify_product_id: '15268755505500',
        shopify_variant_id: '55776453460316',
        sku: 'FENIX-CAFFEINE',
      })],
    })
  })

  it('blocks a Shopify order without a valid SKU before calling FenixCOD', async () => {
    const lockedOrder = queryBuilder({
      data: localOrder({
        status: 'submitting',
        source: 'shopify',
        shopify_integration_id: 'shopify-1',
        raw_shopify_payload: {
          line_items: [{
            product_id: 15268755505500,
            variant_id: 55776453460316,
            sku: null,
            name: 'CAFFEINE',
          }],
        },
        items: [{
          product_id: '15268755505500',
          sku: '55776453460316',
          name: 'CAFFEINE',
          quantity: 1,
          unit_price: 20,
          total: 20,
        }],
      }),
      error: null,
    })
    const eventSubmitting = queryBuilder()
    const catalog = queryBuilder({ data: [], error: null })
    const failedOrder = queryBuilder({ data: localOrder({ status: 'failed' }), error: null })
    const eventFailed = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, failedOrder],
      fulfillment_order_events: [eventSubmitting, eventFailed],
      shopify_products: [catalog],
    })

    await expect(submitFulfillmentOrder('order-1')).rejects.toThrow(
      'não possui SKU válido no Shopify'
    )

    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(failedOrder.updates[0]).toMatchObject({
      status: 'failed',
      send_status: 'Pendente',
    })
  })

  it('turns a FenixCOD product-not-found response into an actionable SKU error', async () => {
    mockCreateLead.mockRejectedValue(new Error('Product Not Found BAD-SKU'))
    const lockedOrder = queryBuilder({ data: localOrder({ status: 'submitting' }), error: null })
    const eventSubmitting = queryBuilder()
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const failedOrder = queryBuilder({ data: localOrder({ status: 'failed' }), error: null })
    const eventFailed = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, failedOrder],
      fulfillment_order_events: [eventSubmitting, eventFailed],
      fulfillment_integrations: [integration],
    })

    await expect(submitFulfillmentOrder('order-1')).rejects.toThrow(
      'O FenixCOD rejeitou o SKU "BAD-SKU" na integração PORTUGAL'
    )
  })

  it('expands an existing Shopify pack into physical units before sending it to FenixCOD', async () => {
    const shopifyPackOrder = localOrder({
      status: 'submitting',
      source: 'shopify',
      shopify_integration_id: 'shopify-1',
      total: 99.9,
      raw_shopify_payload: {
        line_items: [{
          product_id: 100,
          variant_id: 200,
          sku: '-DS-6228,3',
          variant_title: '3 Frascos de Lipogan (37% OFF)',
          name: 'LIPOGAN F4',
          quantity: 1,
          price: '99.90',
        }],
      },
      items: [{
        product_id: '200',
        shopify_product_id: '100',
        shopify_variant_id: '200',
        sku: '-DS-6228,3',
        name: 'LIPOGAN F4',
        quantity: 1,
        unit_price: 99.9,
        total: 99.9,
      }],
    })
    const lockedOrder = queryBuilder({ data: shopifyPackOrder, error: null })
    const eventSubmitting = queryBuilder()
    const catalog = queryBuilder({
      data: [{
        shopify_variant_id: '200',
        sku: '-DS-6228',
        units_per_pack: 3,
        variant_title: '3 Frascos de Lipogan (37% OFF)',
      }],
      error: null,
    })
    const integration = queryBuilder({ data: integrationRow(), error: null })
    const updatedOrder = queryBuilder({ data: localOrder({ status: 'created', lead_number: 'PD-1', total: 99.9 }), error: null })
    const eventCreated = queryBuilder()
    setTableQueues({
      fulfillment_orders: [lockedOrder, updatedOrder],
      fulfillment_order_events: [eventSubmitting, eventCreated],
      shopify_products: [catalog],
      fulfillment_integrations: [integration],
    })

    await submitFulfillmentOrder('order-1')

    expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({
      total: 99.9,
      items: [{ sku: '-DS-6228', quantity: 3, total: 99.9 }],
    }))
    const updatedItems = (updatedOrder.updates[0] as { items: Array<Record<string, unknown>> }).items
    expect(updatedItems[0]).toMatchObject({
      sku: '-DS-6228',
      shopify_quantity: 1,
      units_per_pack: 3,
      pack_quantity_source: 'sku',
      quantity: 3,
      unit_price: 33.3,
      total: 99.9,
    })
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

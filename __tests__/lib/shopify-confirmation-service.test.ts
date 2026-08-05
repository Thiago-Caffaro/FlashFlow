export {}

const mockFrom = jest.fn()
const mockSubmitFulfillmentOrder = jest.fn()
const mockRecordOrderEvent = jest.fn()
const mockSendWhatsAppText = jest.fn()
const mockDecryptSecret = jest.fn(() => 'decoded-secret')
const mockExecuteFlow = jest.fn()
const mockRpc = jest.fn()
const mockEnqueueShopifyOrderFlowJob = jest.fn()
const mockGetDefaultShopifyOrderInstance = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}))

jest.mock('@/lib/flow-engine', () => ({
  executeFlow: mockExecuteFlow,
}))

jest.mock('@/lib/flow-jobs', () => ({
  enqueueShopifyOrderFlowJob: mockEnqueueShopifyOrderFlowJob,
}))

jest.mock('@/lib/shopify-order-settings', () => ({
  getDefaultShopifyOrderInstance: mockGetDefaultShopifyOrderInstance,
}))

jest.mock('@/lib/fulfillment-service', () => ({
  submitFulfillmentOrder: mockSubmitFulfillmentOrder,
  recordOrderEvent: mockRecordOrderEvent,
  FulfillmentOrderSubmissionError: class FulfillmentOrderSubmissionError extends Error {
    constructor(
      message: string,
      public readonly submissionStatus: 'unknown' | 'failed',
      public readonly order?: unknown
    ) {
      super(message)
      this.name = 'FulfillmentOrderSubmissionError'
    }
  },
}))

jest.mock('@/lib/whatsapp-text', () => ({
  sendWhatsAppText: mockSendWhatsAppText,
}))

jest.mock('@/lib/ai-crypto', () => ({
  decryptSecret: mockDecryptSecret,
}))

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryBuilder = {
  inserts: unknown[]
  updates: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  is: jest.Mock<QueryBuilder, [string, unknown]>
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
    id: 'shopify-1',
    shop_name: 'Loja',
    shop_domain: 'example.myshopify.com',
    encrypted_admin_token: 'token',
    admin_token_iv: 'iv',
    admin_token_auth_tag: 'tag',
    encrypted_webhook_secret: 'secret',
    webhook_secret_iv: 'iv',
    webhook_secret_auth_tag: 'tag',
    default_country: 'PORTUGAL',
    active: true,
  }
}

function shopifyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    name: '#1001',
    order_number: 1001,
    email: 'client@example.com',
    phone: '+351 900 000 000',
    currency: 'EUR',
    total_price: '39.90',
    shipping_address: {
      name: 'Cliente Teste',
      address1: 'Rua A',
      city: 'Lisboa',
      province: 'Lisboa',
      zip: '1000-001',
      country_code: 'PORTUGAL',
      phone: '+351 900 000 000',
    },
    line_items: [
      { product_id: 1, variant_id: 2, sku: 'SKU-1', name: 'Produto', quantity: 2, price: '19.95' },
    ],
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  assignConfirmationAccount,
  archiveShopifyOrder,
  mapShopifyOrderPayload,
  shouldSubmitToFenix,
  updateConfirmationOrder,
  upsertShopifyAbandonedCheckout,
  upsertShopifyOrder,
  runShopifyOrderTrigger,
  reserveConfirmationSendSlot,
  _resetConfirmationSendPacingForTests,
} = require('@/lib/shopify-confirmation-service')

describe('shopify-confirmation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetConfirmationSendPacingForTests()
    mockEnqueueShopifyOrderFlowJob.mockResolvedValue({ id: 'job-1' })
    mockSubmitFulfillmentOrder.mockResolvedValue({ id: 'order-1', status: 'created', send_status: 'Enviado' })
    mockGetDefaultShopifyOrderInstance.mockResolvedValue(null)
  })

  it('assigns WhatsApp accounts by country and confirmation priority', async () => {
    const accounts = queryBuilder({ data: { instance_name: 'wa-priority' }, error: null })
    setTableQueues({ accounts: [accounts] })

    const assigned = await assignConfirmationAccount('portugal')

    expect(assigned).toBe('wa-priority')
    expect(accounts.eq).toHaveBeenCalledWith('country', 'PORTUGAL')
    expect(accounts.eq).toHaveBeenCalledWith('confirmation_enabled', true)
    expect(accounts.order).toHaveBeenCalledWith('confirmation_priority', { ascending: true })
    expect(accounts.limit).toHaveBeenCalledWith(1)
  })

  it('uses the configured default account before the country priority', async () => {
    mockGetDefaultShopifyOrderInstance.mockResolvedValue('wa-default')

    const assigned = await assignConfirmationAccount('spain')

    expect(assigned).toBe('wa-default')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('maps a Shopify order payload to the local fulfillment order shape', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder(), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'PORTUGAL',
    }, 'wa-1')

    expect(mapped).toMatchObject({
      source: 'shopify',
      shopify_order_id: '12345',
      shopify_order_name: '#1001',
      instance_name: 'wa-1',
      assigned_instance_name: 'wa-1',
      country: 'PORTUGAL',
      contact_phone: '351900000000',
      customer_name: 'Cliente Teste',
      total: 39.9,
      currency: 'EUR',
    })
    expect(mapped.items).toEqual([
      {
        product_id: '2',
        shopify_product_id: '1',
        shopify_variant_id: '2',
        sku: 'SKU-1',
        name: 'Produto',
        quantity: 2,
        unit_price: 19.95,
        total: 39.9,
      },
    ])
  })

  it('uses the original Shopify total when current_total_price is zero but items are positive', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      current_total_price: '0.00',
      total_price: '49.90',
      line_items: [
        { product_id: 1, variant_id: 2, sku: 'SKU-1', name: 'Produto', quantity: 1, price: '49.90' },
      ],
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'PORTUGAL',
    }, 'wa-1')

    expect(mapped.total).toBe(49.9)
  })

  it('never uses Shopify product or variant ids as a missing SKU', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      line_items: [
        { product_id: 15268755505500, variant_id: 55776453460316, sku: null, name: 'CAFFEINE', quantity: 1, price: '19.95' },
      ],
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'SPAIN',
    }, 'wa-1')

    expect(mapped.items[0]).toMatchObject({
      product_id: '55776453460316',
      shopify_product_id: '15268755505500',
      shopify_variant_id: '55776453460316',
      sku: '',
      name: 'CAFFEINE',
    })
  })

  it('maps Shopify ISO country codes to the FenixCOD country name', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      shipping_address: {
        name: 'Cliente Teste',
        address1: 'Rua A',
        city: 'Lisboa',
        province: 'Lisboa',
        zip: '1000-001',
        country_code: 'ES',
        phone: '+351 900 000 000',
      },
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'PORTUGAL',
    }, 'wa-1')

    expect(mapped.country).toBe('SPAIN')
  })

  it('leaves unmapped country codes as-is (countries FenixCOD does not operate in)', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      shipping_address: {
        name: 'Cliente Teste',
        address1: 'Rua A',
        city: 'Lisboa',
        province: 'Lisboa',
        zip: '1000-001',
        country_code: 'HK',
        phone: '+351 900 000 000',
      },
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'PORTUGAL',
    }, 'wa-1')

    expect(mapped.country).toBe('HK')
  })

  it('upserts Shopify orders idempotently without submitting to Fenix', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({
      data: {
        id: 'order-1',
        assigned_instance_name: 'wa-manual',
        confirmation_message_sent_at: '2026-06-24T10:00:00.000Z',
      },
      error: null,
    })
    const updated = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-manual' }, error: null })
    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, updated],
    })

    const order = await upsertShopifyOrder(integrationRow(), shopifyOrder(), { sendConfirmation: false })

    expect(order).toMatchObject({ id: 'order-1' })
    expect(updated.updates[0]).toMatchObject({
      shopify_order_id: '12345',
      assigned_instance_name: 'wa-manual',
      instance_name: 'wa-manual',
    })
    expect(updated.inserts).toEqual([])
    expect(mockSubmitFulfillmentOrder).not.toHaveBeenCalled()
    expect(mockSendWhatsAppText).not.toHaveBeenCalled()
  })

  it('does not run a confirmation flow when an existing unconfirmed order is reprocessed', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({
      data: {
        id: 'order-1',
        assigned_instance_name: 'wa-country',
        confirmation_message_sent_at: null,
      },
      error: null,
    })
    const updated = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null })
    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, updated],
    })

    await upsertShopifyOrder(integrationRow(), shopifyOrder())

    expect(mockExecuteFlow).not.toHaveBeenCalled()
    expect(mockSendWhatsAppText).not.toHaveBeenCalled()
    expect(updated.update).toHaveBeenCalledTimes(1)
  })

  it('archives a Shopify-deleted order and cancels its pending confirmation job', async () => {
    const existing = queryBuilder({
      data: { id: 'order-1', lead_number: null, status: 'pending_operator', shopify_deleted_at: null },
      error: null,
    })
    const archived = queryBuilder({
      data: { id: 'order-1', status: 'cancelled', shopify_deleted_at: '2026-08-05T12:00:00.000Z' },
      error: null,
    })
    const jobs = queryBuilder()
    setTableQueues({
      fulfillment_orders: [existing, archived],
      flow_jobs: [jobs],
    })

    const result = await archiveShopifyOrder(integrationRow(), { id: 12345 })

    expect(archived.updates[0]).toMatchObject({
      commercial_status: 'Desistiu',
      send_status: 'Não enviar',
      status: 'cancelled',
      shopify_deleted_at: expect.any(String),
    })
    expect(jobs.updates[0]).toMatchObject({ status: 'failed' })
    expect(mockRecordOrderEvent).toHaveBeenCalledWith(
      'order-1',
      'shopify_order_deleted',
      { shopify_order_id: '12345' },
    )
    expect(result).toMatchObject({ id: 'order-1', status: 'cancelled' })
  })

  it('retries pending job cancellation for an order that is already archived', async () => {
    const existing = queryBuilder({
      data: {
        id: 'order-1',
        lead_number: null,
        status: 'cancelled',
        shopify_deleted_at: '2026-08-05T12:00:00.000Z',
      },
      error: null,
    })
    const jobs = queryBuilder()
    setTableQueues({ fulfillment_orders: [existing], flow_jobs: [jobs] })

    await archiveShopifyOrder(integrationRow(), { id: 12345 })

    expect(jobs.updates[0]).toMatchObject({ status: 'failed' })
    expect(mockRecordOrderEvent).not.toHaveBeenCalled()
  })

  it('reserves confirmation starts at least 1.5 seconds apart', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(Date.parse('2026-07-28T12:00:00.000Z'))
    mockRpc
      .mockResolvedValueOnce({ data: '2026-07-28T12:00:00.000Z', error: null })
      .mockResolvedValueOnce({ data: '2026-07-28T12:00:01.500Z', error: null })

    await reserveConfirmationSendSlot()
    let secondResolved = false
    const second = reserveConfirmationSendSlot().then(() => {
      secondResolved = true
    })

    await Promise.resolve()
    expect(secondResolved).toBe(false)

    jest.advanceTimersByTime(1_499)
    await Promise.resolve()
    expect(secondResolved).toBe(false)

    jest.advanceTimersByTime(1)
    await second
    expect(secondResolved).toBe(true)
    jest.useRealTimers()
  })

  it('enfileira uma única confirmação durável para um pedido realmente novo', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({ data: null, error: null }) // pedido novo, nunca confirmado
    const inserted = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null })
    const triggerLookup = queryBuilder({ data: { action_payload: { flow_id: 'flow-1' } }, error: null })

    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, inserted],
      triggers: [triggerLookup],
    })

    await upsertShopifyOrder(integrationRow(), shopifyOrder())

    expect(triggerLookup.eq).toHaveBeenCalledWith('source', 'shopify_order')
    expect(mockEnqueueShopifyOrderFlowJob).toHaveBeenCalledTimes(1)
    expect(mockEnqueueShopifyOrderFlowJob).toHaveBeenCalledWith({
      orderId: 'order-1',
      instanceName: 'wa-country',
      flowId: 'flow-1',
    })
    expect(mockExecuteFlow).not.toHaveBeenCalled()
  })

  it('não enfileira confirmação quando um pedido existente é reprocessado, mesmo sem sent_at', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({
      data: {
        id: 'order-1',
        assigned_instance_name: 'wa-country',
        confirmation_message_sent_at: null,
      },
      error: null,
    })
    const updated = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null })

    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, updated],
    })

    await upsertShopifyOrder(integrationRow(), shopifyOrder())

    expect(mockEnqueueShopifyOrderFlowJob).not.toHaveBeenCalled()
    expect(mockExecuteFlow).not.toHaveBeenCalled()
  })

  it('maps and inserts abandoned checkouts for WhatsApp recovery', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({ data: null, error: null })
    const inserted = queryBuilder({ data: { id: 'checkout-1', recovery_status: 'Pendente' }, error: null })
    setTableQueues({
      accounts: [account],
      shopify_abandoned_checkouts: [existing, inserted],
    })

    const checkout = await upsertShopifyAbandonedCheckout(integrationRow(), {
      id: 987,
      token: 'cart-token',
      email: 'cart@example.com',
      phone: '+351900000001',
      total_price: '29.00',
      currency: 'EUR',
      abandoned_checkout_url: 'https://example.myshopify.com/checkouts/cart-token',
      shipping_address: { name: 'Cliente Carrinho', country_code: 'PORTUGAL' },
    })

    expect(checkout).toMatchObject({ id: 'checkout-1', recovery_status: 'Pendente' })
    expect(inserted.inserts[0]).toMatchObject({
      shopify_checkout_id: '987',
      checkout_token: 'cart-token',
      assigned_instance_name: 'wa-country',
      recovery_status: 'Pendente',
    })
  })

  it('submits only confirmed, pending, non-simulation orders to Fenix', async () => {
    expect(shouldSubmitToFenix({
      commercial_status: 'Confirmado WhatsApp',
      send_status: 'Pendente',
      lead_number: null,
      is_simulation: false,
    })).toBe(true)
    expect(shouldSubmitToFenix({
      commercial_status: 'Desistiu',
      send_status: 'Pendente',
      lead_number: null,
      is_simulation: false,
    })).toBe(false)
    expect(shouldSubmitToFenix({
      commercial_status: 'Confirmado',
      send_status: 'Não enviar',
      lead_number: null,
      is_simulation: false,
    })).toBe(false)
    expect(shouldSubmitToFenix({
      commercial_status: 'Confirmado',
      send_status: 'Pendente',
      lead_number: null,
      is_simulation: true,
    })).toBe(false)
  })

  it('auto-submits after a Confirmado status transition', async () => {
    const updated = queryBuilder({ data: { id: 'order-1', commercial_status: 'Confirmado Call' }, error: null })
    const eligible = queryBuilder({
      data: {
        id: 'order-1',
        lead_number: null,
        commercial_status: 'Confirmado Call',
        send_status: 'Pendente',
        status: 'pending_operator',
        is_simulation: false,
      },
      error: null,
    })
    setTableQueues({ fulfillment_orders: [updated, eligible] })

    const result = await updateConfirmationOrder('order-1', { commercial_status: 'Confirmado Call' })

    expect(updated.updates[0]).toMatchObject({
      commercial_status: 'Confirmado Call',
      confirmed_at: expect.any(String),
    })
    expect(mockSubmitFulfillmentOrder).toHaveBeenCalledWith('order-1')
    expect(result.autoSubmit).toMatchObject({ submitted: true })
  })

  it('updates the confirmation trigger state without submitting to FenixCOD', async () => {
    const updated = queryBuilder({
      data: {
        id: 'order-1',
        commercial_status: 'Confirmado',
        confirmation_message_sent_at: '2026-08-03T10:00:00.000Z',
        confirmation_message_error: null,
      },
      error: null,
    })
    setTableQueues({ fulfillment_orders: [updated] })

    await updateConfirmationOrder('order-1', { confirmation_trigger_state: 'sent' })

    expect(updated.updates[0]).toMatchObject({
      confirmation_message_sent_at: expect.any(String),
      confirmation_message_error: null,
    })
    expect(mockRecordOrderEvent).toHaveBeenCalledWith(
      'order-1',
      'confirmation_trigger_state_updated',
      { state: 'sent' },
    )
    expect(mockSubmitFulfillmentOrder).not.toHaveBeenCalled()
  })

  it('stores the sent timestamp after a manually executed order trigger', async () => {
    const order = queryBuilder({
      data: {
        id: 'order-1',
        customer_name: 'Cliente',
        contact_phone: '351900000000',
        assigned_instance_name: 'wa-1',
        instance_name: 'wa-1',
        is_simulation: false,
      },
      error: null,
    })
    const trigger = queryBuilder({ data: { action_payload: { flow_id: 'flow-1' } }, error: null })
    const conversation = queryBuilder({
      data: {
        id: 'conversation-1',
        wa_id: '351900000000@s.whatsapp.net',
        sandbox_source_instance: null,
        sandbox_real_send_enabled: false,
      },
      error: null,
    })
    const conversationUpdate = queryBuilder({ data: null, error: null })
    const sentUpdate = queryBuilder({
      data: { id: 'order-1', confirmation_message_sent_at: '2026-08-03T10:00:00.000Z' },
      error: null,
    })
    setTableQueues({
      fulfillment_orders: [order, conversationUpdate, sentUpdate],
      triggers: [trigger],
      conversations: [conversation],
    })
    mockRpc.mockResolvedValue({ data: '2026-08-03T10:00:00.000Z', error: null })

    await runShopifyOrderTrigger('order-1')

    expect(mockExecuteFlow).toHaveBeenCalledWith('flow-1', expect.objectContaining({
      instanceName: 'wa-1',
      orderId: 'order-1',
      conversationId: 'conversation-1',
    }))
    expect(sentUpdate.updates[0]).toMatchObject({
      confirmation_message_sent_at: expect.any(String),
      confirmation_message_error: null,
    })
  })

  it('allows correcting the fulfillment country to an active integration without auto-submitting', async () => {
    const existing = queryBuilder({ data: { lead_number: null, country: 'HK' }, error: null })
    const integration = queryBuilder({ data: { id: 'integration-spain' }, error: null })
    const updated = queryBuilder({
      data: {
        id: 'order-1',
        country: 'SPAIN',
        commercial_status: 'Confirmado',
        send_status: 'Pendente',
      },
      error: null,
    })
    setTableQueues({
      fulfillment_orders: [existing, updated],
      fulfillment_integrations: [integration],
    })

    const result = await updateConfirmationOrder('order-1', { country: 'spain' })

    expect(integration.eq).toHaveBeenCalledWith('country', 'SPAIN')
    expect(integration.eq).toHaveBeenCalledWith('active', true)
    expect(updated.updates[0]).toMatchObject({ country: 'SPAIN' })
    expect(mockRecordOrderEvent).toHaveBeenCalledWith('order-1', 'country_updated', {
      previous_country: 'HK',
      new_country: 'SPAIN',
    })
    expect(mockSubmitFulfillmentOrder).not.toHaveBeenCalled()
    expect(result.autoSubmit).toMatchObject({ submitted: false })
  })

  it('rejects a country correction when no active fulfillment integration exists', async () => {
    const existing = queryBuilder({ data: { lead_number: null, country: 'HK' }, error: null })
    const integration = queryBuilder({ data: null, error: null })
    setTableQueues({
      fulfillment_orders: [existing],
      fulfillment_integrations: [integration],
    })

    await expect(updateConfirmationOrder('order-1', { country: 'MARS' }))
      .rejects.toThrow('Integração de fulfillment não configurada para MARS')
  })
})

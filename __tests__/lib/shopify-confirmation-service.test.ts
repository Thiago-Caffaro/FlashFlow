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
const mockPickShopifyStoreAccount = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}))

const mockInterpolateTemplateBody = jest.fn((bodyText: string, parameters: string[]) =>
  bodyText.replace(/\{\{(\d+)\}\}/g, (match: string, num: string) => parameters[Number(num) - 1] ?? match)
)
jest.mock('@/lib/flow-engine', () => ({
  executeFlow: mockExecuteFlow,
  interpolateTemplateBody: (...args: [string, string[]]) => mockInterpolateTemplateBody(...args),
}))

const mockGetAccountProvider = jest.fn()
jest.mock('@/lib/whatsapp-account-provider', () => ({
  getAccountProvider: (...args: unknown[]) => mockGetAccountProvider(...args),
}))

const mockIsWithinMessagingWindow = jest.fn()
jest.mock('@/lib/messaging-window', () => {
  const actual = jest.requireActual('@/lib/messaging-window')
  return {
    isWithinMessagingWindow: (...args: unknown[]) => mockIsWithinMessagingWindow(...args),
    OutsideMessagingWindowError: actual.OutsideMessagingWindowError,
  }
})

const mockLoadWhatsAppTemplateById = jest.fn()
jest.mock('@/lib/whatsapp-templates', () => ({
  loadWhatsAppTemplateById: (...args: unknown[]) => mockLoadWhatsAppTemplateById(...args),
}))

const mockDispatchSendTemplate = jest.fn()
jest.mock('@/lib/whatsapp-dispatch', () => ({
  dispatchSendTemplate: (...args: unknown[]) => mockDispatchSendTemplate(...args),
}))

const mockEnqueueAbandonedCheckoutFlowJob = jest.fn()
const mockCancelPendingAbandonedCheckoutJobs = jest.fn()
const mockCancelStaleAbandonedCheckoutJobs = jest.fn()
jest.mock('@/lib/flow-jobs', () => ({
  enqueueShopifyOrderFlowJob: mockEnqueueShopifyOrderFlowJob,
  enqueueAbandonedCheckoutFlowJob: (...args: unknown[]) => mockEnqueueAbandonedCheckoutFlowJob(...args),
  cancelPendingAbandonedCheckoutJobs: (...args: unknown[]) => mockCancelPendingAbandonedCheckoutJobs(...args),
  cancelStaleAbandonedCheckoutJobs: (...args: unknown[]) => mockCancelStaleAbandonedCheckoutJobs(...args),
  abandonedCheckoutDedupeKey: (checkoutId: string, triggerId: string) => `abandoned-checkout:${checkoutId}:${triggerId}`,
}))

const mockFindShopifyCartAutomation = jest.fn()
const mockGetEnabledAutomationInstance = jest.fn()
jest.mock('@/lib/automation-runtime', () => ({
  findShopifyCartAutomation: (...args: unknown[]) => mockFindShopifyCartAutomation(...args),
  getEnabledAutomationInstance: (...args: unknown[]) => mockGetEnabledAutomationInstance(...args),
}))

const mockGetShopifyTriggersEnabled = jest.fn()
jest.mock('@/lib/shopify-trigger-settings', () => ({
  getShopifyTriggersEnabled: (...args: unknown[]) => mockGetShopifyTriggersEnabled(...args),
}))

jest.mock('@/lib/shopify-order-settings', () => ({
  getDefaultShopifyOrderInstance: mockGetDefaultShopifyOrderInstance,
}))

jest.mock('@/lib/shopify-store-accounts', () => ({
  pickShopifyStoreAccount: mockPickShopifyStoreAccount,
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

type QueryResult = { data: unknown; error: { message: string; code?: string } | null }
type QueryBuilder = {
  inserts: unknown[]
  updates: unknown[]
  upserts: unknown[]
  select: jest.Mock<QueryBuilder, [string?]>
  eq: jest.Mock<QueryBuilder, [string, unknown]>
  neq: jest.Mock<QueryBuilder, [string, unknown]>
  gte: jest.Mock<QueryBuilder, [string, unknown]>
  in: jest.Mock<QueryBuilder, [string, unknown[]]>
  is: jest.Mock<QueryBuilder, [string, unknown]>
  order: jest.Mock<QueryBuilder, [string, unknown?]>
  limit: jest.Mock<QueryBuilder, [number]>
  maybeSingle: jest.Mock<Promise<QueryResult>, []>
  single: jest.Mock<Promise<QueryResult>, []>
  insert: jest.Mock<QueryBuilder, [unknown]>
  update: jest.Mock<QueryBuilder, [unknown]>
  upsert: jest.Mock<QueryBuilder, [unknown, unknown?]>
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

function queryBuilder(result: QueryResult = { data: null, error: null }) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const upserts: unknown[] = []
  let builder: QueryBuilder
  builder = {
    inserts,
    updates,
    upserts,
    select: jest.fn((_columns?: string) => builder),
    eq: jest.fn((_column: string, _value: unknown) => builder),
    neq: jest.fn((_column: string, _value: unknown) => builder),
    gte: jest.fn((_column: string, _value: unknown) => builder),
    in: jest.fn((_column: string, _values: unknown[]) => builder),
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
    upsert: jest.fn((payload: unknown, _opts?: unknown) => {
      upserts.push(payload)
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
  sendAbandonedCheckoutRecovery,
  runAbandonedCheckoutTrigger,
  createSandboxAbandonedCheckout,
  upsertShopifyDraftOrder,
  removeShopifyDraftOrder,
  _resetConfirmationSendPacingForTests,
} = require('@/lib/shopify-confirmation-service')

describe('shopify-confirmation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindShopifyCartAutomation.mockResolvedValue(null)
    _resetConfirmationSendPacingForTests()
    mockEnqueueShopifyOrderFlowJob.mockResolvedValue({ id: 'job-1' })
    mockSubmitFulfillmentOrder.mockResolvedValue({ id: 'order-1', status: 'created', send_status: 'Enviado' })
    mockGetDefaultShopifyOrderInstance.mockResolvedValue(null)
    mockPickShopifyStoreAccount.mockResolvedValue(null)
    mockGetShopifyTriggersEnabled.mockResolvedValue(true)
    mockEnqueueAbandonedCheckoutFlowJob.mockResolvedValue({ id: 'job-cart' })
    mockCancelPendingAbandonedCheckoutJobs.mockResolvedValue(undefined)
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

  it('prefers the accounts linked to the store over the default account', async () => {
    mockPickShopifyStoreAccount.mockResolvedValue('wa-store')
    mockGetDefaultShopifyOrderInstance.mockResolvedValue('wa-default')

    const assigned = await assignConfirmationAccount('spain', 'shopify-2')

    expect(assigned).toBe('wa-store')
    expect(mockPickShopifyStoreAccount).toHaveBeenCalledWith('shopify-2', 'spain')
    expect(mockGetDefaultShopifyOrderInstance).not.toHaveBeenCalled()
  })

  it('falls back to the general rule when the store has no usable linked account', async () => {
    mockPickShopifyStoreAccount.mockResolvedValue(null)
    mockGetDefaultShopifyOrderInstance.mockResolvedValue('wa-default')

    const assigned = await assignConfirmationAccount('spain', 'shopify-2')

    expect(assigned).toBe('wa-default')
  })

  it('maps a Shopify order payload to the local fulfillment order shape', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({ financial_status: 'pending' }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'PORTUGAL',
    }, 'wa-1')

    expect(mapped).toMatchObject({
      source: 'shopify',
      shopify_order_id: '12345',
      shopify_order_name: '#1001',
      shopify_financial_status: 'pending',
      shopify_cancelled_at: null,
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
        shopify_quantity: 2,
        units_per_pack: 1,
        pack_quantity_source: 'default',
        sku: 'SKU-1',
        name: 'Produto',
        quantity: 2,
        unit_price: 19.95,
        total: 39.9,
      },
    ])
  })

  it('converts a Shopify pack SKU into physical FenixCOD units without changing the line total', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      current_total_price: '99.90',
      total_price: '99.90',
      line_items: [{
        product_id: 1,
        variant_id: 2,
        sku: '-DS-6228,3',
        variant_title: '3 Frascos de Lipogan (37% OFF)',
        name: 'LIPOGAN F4 - 3 Frascos de Lipogan (37% OFF)',
        quantity: 1,
        price: '99.90',
      }],
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'SPAIN',
    }, 'wa-1')

    expect(mapped.items[0]).toMatchObject({
      sku: '-DS-6228',
      shopify_quantity: 1,
      units_per_pack: 3,
      pack_quantity_source: 'sku',
      quantity: 3,
      unit_price: 33.3,
      total: 99.9,
    })
  })

  it('multiplies two purchased packs and prefers current_quantity after an order edit', async () => {
    const mapped = await mapShopifyOrderPayload(shopifyOrder({
      current_total_price: '199.80',
      total_price: '299.70',
      line_items: [{
        product_id: 1,
        variant_id: 2,
        sku: '-DS-6228,3',
        variant_title: '3 Frascos',
        name: 'LIPOGAN F4',
        quantity: 3,
        current_quantity: 2,
        price: '99.90',
      }],
    }), {
      id: 'shopify-1',
      shopDomain: 'example.myshopify.com',
      defaultCountry: 'SPAIN',
    }, 'wa-1')

    expect(mapped.items[0]).toMatchObject({
      shopify_quantity: 2,
      units_per_pack: 3,
      quantity: 6,
      unit_price: 33.3,
      total: 199.8,
    })
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

  it('recovers from the create/updated insert race and still queues the confirmation', async () => {
    // orders/updated ganhou a corrida e inseriu o pedido; o orders/create
    // bate na chave única, refaz como update e mantém a confirmação.
    const accounts = () => queryBuilder({ data: { instance_name: 'wa-1' }, error: null })
    setTableQueues({
      accounts: [accounts(), accounts()],
      fulfillment_orders: [
        queryBuilder({ data: null, error: null }),
        queryBuilder({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "fulfillment_orders_order_number_key"' } }),
        queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-1', confirmation_message_sent_at: null, shopify_financial_status: 'pending', shopify_cancelled_at: null }, error: null }),
        queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-1', instance_name: 'wa-1' }, error: null }),
      ],
      triggers: [queryBuilder({ data: { action_payload: { flow_id: 'flow-1' } }, error: null })],
      shopify_abandoned_checkouts: [queryBuilder({ data: [], error: null }), queryBuilder({ data: [], error: null })],
    })

    const order = await upsertShopifyOrder(integrationRow(), shopifyOrder(), { sendConfirmation: true })

    expect(order).toMatchObject({ id: 'order-1' })
    expect(mockEnqueueShopifyOrderFlowJob).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', flowId: 'flow-1' }))
  })

  describe('rascunhos (draft orders)', () => {
    function draftPayload(overrides: Record<string, unknown> = {}) {
      return {
        id: 555,
        name: '#D12',
        status: 'open',
        order_id: null,
        email: 'rascunho@example.com',
        phone: '+573001112233',
        total_price: '120000.00',
        currency: 'COP',
        invoice_url: 'https://loja.myshopify.com/123/invoices/abc',
        shipping_address: { name: 'Cliente Rascunho', country_code: 'CO' },
        line_items: [{ title: 'Produto', quantity: 1, price: '120000.00' }],
        created_at: '2026-10-20T10:00:00.000Z',
        updated_at: '2026-10-20T10:05:00.000Z',
        ...overrides,
      }
    }

    it('saves an open draft as an abandoned cart with its own id space, name and invoice link', async () => {
      const inserted = queryBuilder({ data: { id: 'checkout-d1', recovery_status: 'Pendente' }, error: null })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-co' }, error: null })],
        shopify_abandoned_checkouts: [queryBuilder({ data: null, error: null }), inserted],
      })

      await upsertShopifyDraftOrder(integrationRow(), draftPayload(), { scheduleTriggers: false })

      expect(inserted.inserts[0]).toMatchObject({
        shopify_checkout_id: 'draft:555',
        source: 'draft_order',
        shopify_name: '#D12',
        checkout_token: null,
        abandoned_checkout_url: 'https://loja.myshopify.com/123/invoices/abc',
        recovery_status: 'Pendente',
        shopify_completed_at: null,
      })
    })

    it('marks a draft completed in Shopify (converted into an order) as Convertido', async () => {
      const existing = queryBuilder({ data: { id: 'checkout-d1', assigned_instance_name: 'wa-co', recovery_status: 'Enviado' }, error: null })
      const updated = queryBuilder({ data: { id: 'checkout-d1', recovery_status: 'Convertido' }, error: null })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-co' }, error: null })],
        shopify_abandoned_checkouts: [existing, updated],
      })

      await upsertShopifyDraftOrder(integrationRow(), draftPayload({ status: 'completed', order_id: 9001 }))

      expect(updated.updates[0]).toMatchObject({ recovery_status: 'Convertido', source: 'draft_order' })
      expect(mockCancelPendingAbandonedCheckoutJobs).toHaveBeenCalledWith(['checkout-d1'], expect.any(String))
    })

    it('stops reminders for a deleted draft that was not converted', async () => {
      const found = queryBuilder({ data: { id: 'checkout-d1', recovery_status: 'Pendente' }, error: null })
      const updated = queryBuilder({ data: null, error: null })
      setTableQueues({ shopify_abandoned_checkouts: [found, updated] })

      const result = await removeShopifyDraftOrder(integrationRow(), { id: 555 })

      expect(result).toEqual({ id: 'checkout-d1' })
      expect(found.eq).toHaveBeenCalledWith('shopify_checkout_id', 'draft:555')
      expect(updated.updates[0]).toMatchObject({ recovery_status: 'Não enviar' })
      expect(mockCancelPendingAbandonedCheckoutJobs).toHaveBeenCalledWith(['checkout-d1'], 'Rascunho excluído na Shopify')
    })

    it('does not write source on plain checkouts (works before migration 028)', async () => {
      const inserted = queryBuilder({ data: { id: 'checkout-1', recovery_status: 'Pendente' }, error: null })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-country' }, error: null })],
        shopify_abandoned_checkouts: [queryBuilder({ data: null, error: null }), inserted],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), { id: 987, token: 't', phone: '+351900000001', shipping_address: { country_code: 'PT' } }, { scheduleTriggers: false })

      expect(inserted.inserts[0]).not.toHaveProperty('source')
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

  describe('sendAbandonedCheckoutRecovery', () => {
    function checkoutRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'checkout-1',
        is_simulation: false,
        recovery_status: 'Pendente',
        assigned_instance_name: 'wa-1',
        contact_phone: '351900000000',
        customer_name: 'Maria',
        shopify_integration_id: 'int-1',
        abandoned_checkout_url: 'https://loja.example/cart/abc',
        total: 49.9,
        currency: 'EUR',
        ...overrides,
      }
    }

    function integrationRow(overrides: Record<string, unknown> = {}) {
      return {
        recovery_message_template: null,
        recovery_template_id: null,
        recovery_template_variable_map: {},
        ...overrides,
      }
    }

    function existingConversation() {
      return { id: 'conv-1', wa_id: '351900000000@s.whatsapp.net', sandbox_source_instance: null, sandbox_real_send_enabled: false }
    }

    it('sends free text on an evolution account without ever checking the messaging window', async () => {
      mockGetAccountProvider.mockResolvedValue('evolution')
      mockSendWhatsAppText.mockResolvedValue({ messageId: 'wamid.1', response: {} })
      const checkout = queryBuilder({ data: checkoutRow(), error: null })
      const conversations = queryBuilder({ data: existingConversation(), error: null })
      const integration = queryBuilder({ data: integrationRow(), error: null })
      const messages = queryBuilder()
      const conversationsUpdate = queryBuilder()
      const checkoutUpdate = queryBuilder({ data: { id: 'checkout-1', recovery_status: 'Enviado' }, error: null })
      setTableQueues({
        shopify_abandoned_checkouts: [checkout, checkoutUpdate],
        conversations: [conversations, conversationsUpdate],
        shopify_integrations: [integration],
        messages: [messages],
      })

      const result = await sendAbandonedCheckoutRecovery('checkout-1')

      expect(mockIsWithinMessagingWindow).not.toHaveBeenCalled()
      expect(mockSendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({ instanceName: 'wa-1', number: '351900000000' }))
      expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
      expect(messages.inserts[0]).toMatchObject({ conversation_id: 'conv-1', direction: 'outbound', wa_message_id: 'wamid.1' })
      expect(checkoutUpdate.updates[0]).toMatchObject({ recovery_status: 'Enviado', last_error: null })
      expect(result.messageId).toBe('wamid.1')
    })

    it('sends free text on a cloud_api account when within the 24h window', async () => {
      mockGetAccountProvider.mockResolvedValue('cloud_api')
      mockIsWithinMessagingWindow.mockResolvedValue(true)
      mockSendWhatsAppText.mockResolvedValue({ messageId: 'wamid.2', response: {} })
      const checkout = queryBuilder({ data: checkoutRow(), error: null })
      const conversations = queryBuilder({ data: existingConversation(), error: null })
      const integration = queryBuilder({ data: integrationRow(), error: null })
      const messages = queryBuilder()
      const conversationsUpdate = queryBuilder()
      const checkoutUpdate = queryBuilder({ data: { id: 'checkout-1' }, error: null })
      setTableQueues({
        shopify_abandoned_checkouts: [checkout, checkoutUpdate],
        conversations: [conversations, conversationsUpdate],
        shopify_integrations: [integration],
        messages: [messages],
      })

      await sendAbandonedCheckoutRecovery('checkout-1')

      expect(mockIsWithinMessagingWindow).toHaveBeenCalledWith('conv-1')
      expect(mockSendWhatsAppText).toHaveBeenCalled()
      expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
    })

    it('sends via the configured template on a cloud_api account outside the window', async () => {
      mockGetAccountProvider.mockResolvedValue('cloud_api')
      mockIsWithinMessagingWindow.mockResolvedValue(false)
      mockLoadWhatsAppTemplateById.mockResolvedValue({
        id: 'tpl-1', variable_count: 1, body_text: 'Olá {{1}}, seu carrinho ainda está disponível.',
        meta_template_name: 'cart_recovery', language: 'pt_BR',
      })
      mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: {} })
      const checkout = queryBuilder({ data: checkoutRow(), error: null })
      const conversations = queryBuilder({ data: existingConversation(), error: null })
      const integration = queryBuilder({
        data: integrationRow({ recovery_template_id: 'tpl-1', recovery_template_variable_map: { '1': 'Maria' } }),
        error: null,
      })
      const messages = queryBuilder()
      const conversationsUpdate = queryBuilder()
      const checkoutUpdate = queryBuilder({ data: { id: 'checkout-1' }, error: null })
      setTableQueues({
        shopify_abandoned_checkouts: [checkout, checkoutUpdate],
        conversations: [conversations, conversationsUpdate],
        shopify_integrations: [integration],
        messages: [messages],
      })

      const result = await sendAbandonedCheckoutRecovery('checkout-1')

      expect(mockSendWhatsAppText).not.toHaveBeenCalled()
      expect(mockLoadWhatsAppTemplateById).toHaveBeenCalledWith('tpl-1')
      expect(mockDispatchSendTemplate).toHaveBeenCalledWith('wa-1', '351900000000@s.whatsapp.net', 'cart_recovery', 'pt_BR', ['Maria'])
      expect(messages.inserts[0]).toMatchObject({ content: 'Olá Maria, seu carrinho ainda está disponível.', wa_message_id: 'wamid.tpl' })
      expect(result.messageId).toBe('wamid.tpl')
    })

    it('creates a plain-digit conversation (no @s.whatsapp.net JID suffix) for a new cloud_api contact', async () => {
      mockGetAccountProvider.mockResolvedValue('cloud_api')
      mockIsWithinMessagingWindow.mockResolvedValue(false)
      mockLoadWhatsAppTemplateById.mockResolvedValue({
        id: 'tpl-1', variable_count: 1, body_text: 'Olá {{1}}, seu carrinho ainda está disponível.',
        meta_template_name: 'cart_recovery', language: 'pt_BR',
      })
      mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.new', raw: {} })
      const checkout = queryBuilder({ data: checkoutRow(), error: null })
      // Sem conversa existente (primeiro contato) — resolveConversationForOrder
      // cai no branch de criação via upsert.
      const conversationsLookup = queryBuilder({ data: null, error: null })
      const conversationsUpsert = queryBuilder({ data: { id: 'conv-new' }, error: null })
      const integration = queryBuilder({
        data: integrationRow({ recovery_template_id: 'tpl-1', recovery_template_variable_map: { '1': 'Maria' } }),
        error: null,
      })
      const messages = queryBuilder()
      const conversationsUpdate = queryBuilder()
      const checkoutUpdate = queryBuilder({ data: { id: 'checkout-1' }, error: null })
      setTableQueues({
        shopify_abandoned_checkouts: [checkout, checkoutUpdate],
        conversations: [conversationsLookup, conversationsUpsert, conversationsUpdate],
        shopify_integrations: [integration],
        messages: [messages],
      })

      await sendAbandonedCheckoutRecovery('checkout-1')

      expect(conversationsUpsert.upserts[0]).toMatchObject({ wa_id: '351900000000', contact_phone: '351900000000' })
      expect(mockDispatchSendTemplate).toHaveBeenCalledWith('wa-1', '351900000000', 'cart_recovery', 'pt_BR', ['Maria'])
    })

    it('fails clearly instead of attempting a doomed send when outside the window with no template configured', async () => {
      mockGetAccountProvider.mockResolvedValue('cloud_api')
      mockIsWithinMessagingWindow.mockResolvedValue(false)
      const checkout = queryBuilder({ data: checkoutRow(), error: null })
      const conversations = queryBuilder({ data: existingConversation(), error: null })
      const integration = queryBuilder({ data: integrationRow(), error: null })
      const checkoutUpdate = queryBuilder({ data: { id: 'checkout-1' }, error: null })
      setTableQueues({
        shopify_abandoned_checkouts: [checkout, checkoutUpdate],
        conversations: [conversations],
        shopify_integrations: [integration],
      })

      await expect(sendAbandonedCheckoutRecovery('checkout-1')).rejects.toThrow('template de recuperação')

      expect(mockSendWhatsAppText).not.toHaveBeenCalled()
      expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
      expect(checkoutUpdate.updates[0]).toMatchObject({ last_error: expect.stringContaining('template de recuperação') })
    })

    it('rejects a simulated checkout without touching any provider/window logic', async () => {
      const checkout = queryBuilder({ data: checkoutRow({ is_simulation: true }), error: null })
      setTableQueues({ shopify_abandoned_checkouts: [checkout] })

      await expect(sendAbandonedCheckoutRecovery('checkout-1')).rejects.toThrow('simulação não envia WhatsApp real')
      expect(mockGetAccountProvider).not.toHaveBeenCalled()
    })
  })

  describe('gatilho de carrinho abandonado', () => {
    const NOW = Date.parse('2026-09-30T12:00:00.000Z')
    const MINUTE = 60 * 1000

    function savedCheckout(overrides: Record<string, unknown> = {}) {
      return {
        id: 'checkout-1',
        shopify_integration_id: 'shopify-1',
        checkout_token: 'cart-token',
        assigned_instance_name: 'wa-1',
        contact_phone: '351900000001',
        customer_name: 'Cliente Carrinho',
        recovery_status: 'Pendente',
        is_simulation: false,
        shopify_completed_at: null,
        raw_shopify_payload: {
          created_at: new Date(NOW - 20 * MINUTE).toISOString(),
          updated_at: new Date(NOW - 10 * MINUTE).toISOString(),
        },
        created_at: new Date(NOW - 20 * MINUTE).toISOString(),
        ...overrides,
      }
    }

    function checkoutPayload(overrides: Record<string, unknown> = {}) {
      return {
        id: 987,
        token: 'cart-token',
        phone: '+351900000001',
        total_price: '29.00',
        currency: 'EUR',
        shipping_address: { name: 'Cliente Carrinho', country_code: 'PORTUGAL' },
        ...overrides,
      }
    }

    afterEach(() => jest.useRealTimers())

    it('agenda um job por gatilho, contando o delay a partir da última atividade no checkout', async () => {
      jest.useFakeTimers({ now: NOW })
      const triggers = queryBuilder({
        data: [
          { id: 'trigger-1h', delay_ms: 0, action_payload: { flow_id: 'flow-1' } },
          { id: 'trigger-24h', delay_ms: 24 * 60 * MINUTE, action_payload: { flow_id: 'flow-2' } },
          { id: 'trigger-sem-fluxo', delay_ms: MINUTE, action_payload: {} },
        ],
        error: null,
      })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
        shopify_abandoned_checkouts: [
          queryBuilder({ data: null, error: null }),
          queryBuilder({ data: savedCheckout(), error: null }),
        ],
        triggers: [triggers],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

      expect(triggers.eq).toHaveBeenCalledWith('source', 'shopify_abandoned_checkout')
      expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledTimes(2)
      // delay_ms 0 cai no padrão de 60 min, contado a partir do updated_at da Shopify
      expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith({
        checkoutId: 'checkout-1',
        triggerId: 'trigger-1h',
        instanceName: 'wa-1',
        flowId: 'flow-1',
        runAt: new Date(NOW + 50 * MINUTE),
      })
      expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({
        triggerId: 'trigger-24h',
        runAt: new Date(NOW - 10 * MINUTE + 24 * 60 * MINUTE),
      }))
    })

    describe('carrinho simulado no sandbox', () => {
      function sandboxInput(immediate: boolean) {
        return {
          integrationId: 'shopify-1',
          shopDomain: 'loja.myshopify.com',
          defaultCountry: 'SPAIN',
          payload: checkoutPayload({ created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() }),
          contactPhone: '000000000',
          immediate,
        }
      }

      it('grava como simulação na conta sandbox e dispara agora, mesmo com os gatilhos Shopify pausados', async () => {
        jest.useFakeTimers({ now: NOW })
        mockGetShopifyTriggersEnabled.mockResolvedValue(false)
        const insert = queryBuilder({
          data: savedCheckout({
            assigned_instance_name: '__sandbox__',
            is_simulation: true,
            contact_phone: '000000000',
            raw_shopify_payload: { created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() },
          }),
          error: null,
        })
        setTableQueues({
          shopify_abandoned_checkouts: [insert],
          triggers: [queryBuilder({ data: [{ id: 'trigger-cart', delay_ms: 0, action_payload: { flow_id: 'flow-cart' } }], error: null })],
        })

        const result = await createSandboxAbandonedCheckout(sandboxInput(true))

        expect(result.scheduled).toBe(1)
        expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({
          assigned_instance_name: '__sandbox__',
          is_simulation: true,
          contact_phone: '000000000',
          recovery_status: 'Pendente',
        }))
        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({
          instanceName: '__sandbox__',
          flowId: 'flow-cart',
          runAt: new Date(NOW),
        }))
      })

      it('respeita o delay do gatilho quando não é para disparar agora', async () => {
        jest.useFakeTimers({ now: NOW })
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({
            data: savedCheckout({
              assigned_instance_name: '__sandbox__',
              is_simulation: true,
              raw_shopify_payload: { created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() },
            }),
            error: null,
          })],
          triggers: [queryBuilder({ data: [{ id: 'trigger-cart', delay_ms: 0, action_payload: { flow_id: 'flow-cart' } }], error: null })],
        })

        await createSandboxAbandonedCheckout(sandboxInput(false))

        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({
          runAt: new Date(NOW + 60 * MINUTE),
        }))
      })
    })

    it('ignora carrinho sem telefone', async () => {
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
        shopify_abandoned_checkouts: [
          queryBuilder({ data: null, error: null }),
          queryBuilder({ data: savedCheckout({ contact_phone: null }), error: null }),
        ],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload({ phone: null, email: 'so@email.com' }))

      expect(mockEnqueueAbandonedCheckoutFlowJob).not.toHaveBeenCalled()
    })

    it('não agenda nada quando os gatilhos Shopify estão pausados', async () => {
      mockGetShopifyTriggersEnabled.mockResolvedValue(false)
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
        shopify_abandoned_checkouts: [
          queryBuilder({ data: null, error: null }),
          queryBuilder({ data: savedCheckout(), error: null }),
        ],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

      expect(mockEnqueueAbandonedCheckoutFlowJob).not.toHaveBeenCalled()
    })

    it('não agenda checkout cuja hora de envio já passou há muito (webhook atrasado)', async () => {
      jest.useFakeTimers({ now: NOW })
      const stale = savedCheckout({
        raw_shopify_payload: { updated_at: new Date(NOW - 3 * 24 * 60 * MINUTE).toISOString() },
      })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
        shopify_abandoned_checkouts: [
          queryBuilder({ data: null, error: null }),
          queryBuilder({ data: stale, error: null }),
        ],
        triggers: [queryBuilder({ data: [{ id: 'trigger-1h', delay_ms: 0, action_payload: { flow_id: 'flow-1' } }], error: null })],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

      expect(mockEnqueueAbandonedCheckoutFlowJob).not.toHaveBeenCalled()
    })

    it('marca Convertido e cancela lembretes quando a Shopify conclui o checkout', async () => {
      const updated = queryBuilder({
        data: savedCheckout({ recovery_status: 'Convertido', shopify_completed_at: '2026-09-30T11:55:00.000Z' }),
        error: null,
      })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
        shopify_abandoned_checkouts: [
          queryBuilder({ data: { id: 'checkout-1', assigned_instance_name: 'wa-1', recovery_status: 'Pendente' }, error: null }),
          updated,
        ],
      })

      await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload({ completed_at: '2026-09-30T11:55:00.000Z' }))

      expect(updated.updates[0]).toMatchObject({
        recovery_status: 'Convertido',
        recovered_at: expect.any(String),
        shopify_completed_at: '2026-09-30T11:55:00.000Z',
      })
      expect(mockCancelPendingAbandonedCheckoutJobs).toHaveBeenCalledWith(['checkout-1'], expect.any(String))
      expect(mockEnqueueAbandonedCheckoutFlowJob).not.toHaveBeenCalled()
    })

    it('marca o carrinho de origem como Convertido quando o pedido Shopify chega', async () => {
      const byToken = queryBuilder({ data: [{ id: 'checkout-1' }], error: null })
      const converted = queryBuilder({ data: null, error: null })
      setTableQueues({
        accounts: [queryBuilder({ data: { instance_name: 'wa-country' }, error: null })],
        fulfillment_orders: [
          queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null }),
          queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null }),
        ],
        shopify_abandoned_checkouts: [byToken, converted],
      })

      await upsertShopifyOrder(integrationRow(), shopifyOrder({ checkout_token: 'cart-token' }), { sendConfirmation: false })

      expect(byToken.eq).toHaveBeenCalledWith('checkout_token', 'cart-token')
      expect(converted.updates[0]).toMatchObject({ recovery_status: 'Convertido', recovered_at: expect.any(String) })
      expect(converted.in).toHaveBeenCalledWith('id', ['checkout-1'])
      expect(mockCancelPendingAbandonedCheckoutJobs).toHaveBeenCalledWith(['checkout-1'], 'Carrinho convertido em pedido')
    })

    describe('automação simples de carrinho', () => {
      function cartAutomation(overrides: Record<string, unknown> = {}) {
        return {
          automation: {
            id: 'auto-1',
            name: 'Carrinho PT',
            kind: 'abandoned_cart',
            platform: 'shopify',
            country: 'PT',
            product_line_id: 'line-ema',
            instance_name: 'wa-auto',
            enabled: true,
            steps: [
              { id: 'step-1', position: 1, delay_minutes: 30, flow_id: 'flow-auto-1' },
              { id: 'step-2', position: 2, delay_minutes: 24 * 60, flow_id: 'flow-auto-2' },
            ],
            ...overrides,
          },
          productLineId: 'line-ema',
        }
      }

      it('agenda os lembretes da automação pelo número dela, no lugar dos gatilhos da conta', async () => {
        jest.useFakeTimers({ now: NOW })
        mockFindShopifyCartAutomation.mockResolvedValue(cartAutomation())
        setTableQueues({
          accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
          shopify_abandoned_checkouts: [
            queryBuilder({ data: null, error: null }),
            queryBuilder({ data: savedCheckout({ country: 'PORTUGAL' }), error: null }),
          ],
          // sem fila de triggers: consultar os gatilhos da conta quebraria o teste
        })

        await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

        expect(mockFindShopifyCartAutomation).toHaveBeenCalledWith(expect.objectContaining({
          integrationId: 'shopify-1',
          country: 'PORTUGAL',
        }))
        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledTimes(2)
        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith({
          checkoutId: 'checkout-1',
          triggerId: 'automation:auto-1:1',
          instanceName: 'wa-auto',
          flowId: 'flow-auto-1',
          runAt: new Date(NOW + 20 * MINUTE),
          automationId: 'auto-1',
        })
        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({
          triggerId: 'automation:auto-1:2',
          runAt: new Date(NOW - 10 * MINUTE + 24 * 60 * MINUTE),
        }))
        // Jobs pendentes de gatilho da conta são cancelados; os da automação ficam.
        const [checkoutId, keep] = mockCancelStaleAbandonedCheckoutJobs.mock.calls[0]
        expect(checkoutId).toBe('checkout-1')
        expect(keep('abandoned-checkout:checkout-1:automation:auto-1:1')).toBe(true)
        expect(keep('abandoned-checkout:checkout-1:trigger-1h')).toBe(false)
      })

      it('vale mesmo sem conta atribuída ao carrinho', async () => {
        jest.useFakeTimers({ now: NOW })
        mockFindShopifyCartAutomation.mockResolvedValue(cartAutomation())
        setTableQueues({
          accounts: [queryBuilder({ data: null, error: null })],
          shopify_abandoned_checkouts: [
            queryBuilder({ data: null, error: null }),
            queryBuilder({ data: savedCheckout({ assigned_instance_name: null }), error: null }),
          ],
        })

        await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({ instanceName: 'wa-auto' }))
      })

      it('sem automação, segue nos gatilhos da conta e cancela lembretes de automação antigos', async () => {
        jest.useFakeTimers({ now: NOW })
        setTableQueues({
          accounts: [queryBuilder({ data: { instance_name: 'wa-1' }, error: null })],
          shopify_abandoned_checkouts: [
            queryBuilder({ data: null, error: null }),
            queryBuilder({ data: savedCheckout(), error: null }),
          ],
          triggers: [queryBuilder({ data: [{ id: 'trigger-1h', delay_ms: 0, action_payload: { flow_id: 'flow-1' } }], error: null })],
        })

        await upsertShopifyAbandonedCheckout(integrationRow(), checkoutPayload())

        expect(mockEnqueueAbandonedCheckoutFlowJob).toHaveBeenCalledWith(expect.objectContaining({ triggerId: 'trigger-1h', instanceName: 'wa-1' }))
        const [, keep] = mockCancelStaleAbandonedCheckoutJobs.mock.calls[0]
        expect(keep('abandoned-checkout:checkout-1:automation:auto-1:1')).toBe(false)
        expect(keep('abandoned-checkout:checkout-1:trigger-1h')).toBe(true)
      })

      it('carrinho simulado no sandbox não procura automação', async () => {
        jest.useFakeTimers({ now: NOW })
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({
            data: savedCheckout({ assigned_instance_name: '__sandbox__', is_simulation: true }),
            error: null,
          })],
          triggers: [queryBuilder({ data: [], error: null })],
        })

        await createSandboxAbandonedCheckout({
          integrationId: 'shopify-1',
          shopDomain: 'loja.myshopify.com',
          defaultCountry: 'SPAIN',
          payload: checkoutPayload(),
          contactPhone: '000000000',
          immediate: true,
        })

        expect(mockFindShopifyCartAutomation).not.toHaveBeenCalled()
        expect(mockCancelStaleAbandonedCheckoutJobs).not.toHaveBeenCalled()
      })

      it('não envia lembrete de automação desligada depois do agendamento', async () => {
        mockGetEnabledAutomationInstance.mockResolvedValue(null)
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({ data: savedCheckout(), error: null })],
        })

        const result = await runAbandonedCheckoutTrigger('checkout-1', 'flow-auto-1', { automationId: 'auto-1' })

        expect(result).toEqual({ skipped: 'Automação desligada ou apagada' })
        expect(mockExecuteFlow).not.toHaveBeenCalled()
      })

      it('envia o lembrete pelo número atual da automação', async () => {
        mockRpc.mockResolvedValue({ data: '2000-01-01T00:00:00.000Z', error: null })
        mockExecuteFlow.mockResolvedValue(undefined)
        mockGetEnabledAutomationInstance.mockResolvedValue('wa-auto')
        const conversation = queryBuilder({
          data: { id: 'conv-9', wa_id: '351900000001@s.whatsapp.net', sandbox_source_instance: null, sandbox_real_send_enabled: false },
          error: null,
        })
        setTableQueues({
          shopify_abandoned_checkouts: [
            queryBuilder({ data: savedCheckout(), error: null }),
            queryBuilder({ data: savedCheckout({ recovery_status: 'Enviado' }), error: null }),
          ],
          fulfillment_orders: [queryBuilder({ data: null, error: null }), queryBuilder({ data: null, error: null })],
          conversations: [conversation],
        })

        await runAbandonedCheckoutTrigger('checkout-1', 'flow-auto-1', { automationId: 'auto-1' })

        expect(conversation.eq).toHaveBeenCalledWith('instance_name', 'wa-auto')
        expect(mockExecuteFlow).toHaveBeenCalledWith('flow-auto-1', expect.objectContaining({ instanceName: 'wa-auto' }))
      })
    })

    describe('runAbandonedCheckoutTrigger', () => {
      it('não envia para carrinho marcado como Não enviar', async () => {
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({ data: savedCheckout({ recovery_status: 'Não enviar' }), error: null })],
        })

        const result = await runAbandonedCheckoutTrigger('checkout-1', 'flow-1')

        expect(result).toMatchObject({ skipped: expect.stringContaining('Não enviar') })
        expect(mockExecuteFlow).not.toHaveBeenCalled()
      })

      it('não envia e marca Convertido quando já existe pedido com o mesmo checkout_token', async () => {
        const orderByToken = queryBuilder({ data: { id: 'order-9' }, error: null })
        const converted = queryBuilder({ data: null, error: null })
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({ data: savedCheckout(), error: null }), converted],
          fulfillment_orders: [orderByToken],
        })

        const result = await runAbandonedCheckoutTrigger('checkout-1', 'flow-1')

        expect(orderByToken.eq).toHaveBeenCalledWith('raw_shopify_payload->>checkout_token', 'cart-token')
        expect(result).toMatchObject({ skipped: 'Carrinho já convertido em pedido' })
        expect(converted.updates[0]).toMatchObject({ recovery_status: 'Convertido' })
        expect(mockExecuteFlow).not.toHaveBeenCalled()
      })

      it('não envia quando o cliente comprou depois do checkout por outro caminho (mesmo telefone)', async () => {
        const byPhone = queryBuilder({ data: { id: 'order-10' }, error: null })
        setTableQueues({
          shopify_abandoned_checkouts: [
            queryBuilder({ data: savedCheckout(), error: null }),
            queryBuilder({ data: null, error: null }),
          ],
          fulfillment_orders: [queryBuilder({ data: null, error: null }), byPhone],
        })

        const result = await runAbandonedCheckoutTrigger('checkout-1', 'flow-1')

        expect(byPhone.eq).toHaveBeenCalledWith('contact_phone', '351900000001')
        expect(byPhone.gte).toHaveBeenCalledWith('order_placed_at', new Date(NOW - 20 * MINUTE).toISOString())
        expect(result).toMatchObject({ skipped: 'Carrinho já convertido em pedido' })
        expect(mockExecuteFlow).not.toHaveBeenCalled()
      })

      it('executa o fluxo com o checkoutId e marca o carrinho como Enviado', async () => {
        mockRpc.mockResolvedValue({ data: '2000-01-01T00:00:00.000Z', error: null })
        mockExecuteFlow.mockResolvedValue(undefined)
        const sent = queryBuilder({ data: savedCheckout({ recovery_status: 'Enviado' }), error: null })
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({ data: savedCheckout(), error: null }), sent],
          fulfillment_orders: [queryBuilder({ data: null, error: null }), queryBuilder({ data: null, error: null })],
          conversations: [queryBuilder({
            data: { id: 'conv-1', wa_id: '351900000001@s.whatsapp.net', sandbox_source_instance: null, sandbox_real_send_enabled: false },
            error: null,
          })],
        })

        const result = await runAbandonedCheckoutTrigger('checkout-1', 'flow-1')

        expect(mockExecuteFlow).toHaveBeenCalledWith('flow-1', expect.objectContaining({
          instanceName: 'wa-1',
          conversationId: 'conv-1',
          remoteJid: '351900000001@s.whatsapp.net',
          checkoutId: 'checkout-1',
          isSandbox: false,
        }))
        expect(sent.updates[0]).toMatchObject({ recovery_status: 'Enviado', whatsapp_sent_at: expect.any(String), last_error: null })
        expect(result).toMatchObject({ conversationId: 'conv-1' })
      })

      it('grava last_error e relança para o worker tentar de novo quando o fluxo falha', async () => {
        mockRpc.mockResolvedValue({ data: '2000-01-01T00:00:00.000Z', error: null })
        mockExecuteFlow.mockRejectedValue(new Error('Evolution indisponivel'))
        const failed = queryBuilder({ data: null, error: null })
        setTableQueues({
          shopify_abandoned_checkouts: [queryBuilder({ data: savedCheckout(), error: null }), failed],
          fulfillment_orders: [queryBuilder({ data: null, error: null }), queryBuilder({ data: null, error: null })],
          conversations: [queryBuilder({
            data: { id: 'conv-1', wa_id: '351900000001@s.whatsapp.net', sandbox_source_instance: null, sandbox_real_send_enabled: false },
            error: null,
          })],
        })

        await expect(runAbandonedCheckoutTrigger('checkout-1', 'flow-1')).rejects.toThrow('Evolution indisponivel')
        expect(failed.updates[0]).toMatchObject({ last_error: 'Evolution indisponivel' })
      })
    })
  })
})

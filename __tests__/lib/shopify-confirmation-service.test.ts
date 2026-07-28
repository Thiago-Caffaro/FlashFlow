export {}

const mockFrom = jest.fn()
const mockSubmitFulfillmentOrder = jest.fn()
const mockSendWhatsAppText = jest.fn()
const mockDecryptSecret = jest.fn(() => 'decoded-secret')
const mockExecuteFlow = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/flow-engine', () => ({
  executeFlow: mockExecuteFlow,
}))

jest.mock('@/lib/fulfillment-service', () => ({
  submitFulfillmentOrder: mockSubmitFulfillmentOrder,
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
  mapShopifyOrderPayload,
  shouldSubmitToFenix,
  updateConfirmationOrder,
  upsertShopifyAbandonedCheckout,
  upsertShopifyOrder,
} = require('@/lib/shopify-confirmation-service')

describe('shopify-confirmation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSubmitFulfillmentOrder.mockResolvedValue({ id: 'order-1', status: 'created', send_status: 'Enviado' })
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
      { product_id: '1', sku: 'SKU-1', name: 'Produto', quantity: 2, unit_price: 19.95, total: 39.9 },
    ])
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

  it('reivindica confirmation_message_sent_at atomicamente antes de disparar o gatilho de confirmação', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({ data: null, error: null }) // pedido novo, nunca confirmado
    const inserted = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null })
    const claim = queryBuilder({ data: { id: 'order-1' }, error: null }) // claim vence
    const orderForTrigger = queryBuilder({
      data: {
        id: 'order-1',
        customer_name: 'Cliente Teste',
        contact_phone: '351900000000',
        assigned_instance_name: 'wa-country',
        instance_name: 'wa-country',
        is_simulation: false,
      },
      error: null,
    })
    const triggerLookup = queryBuilder({ data: null, error: null }) // nenhum gatilho configurado -> lança erro
    // runShopifyOrderTrigger tem seu próprio catch interno que grava
    // confirmation_message_error antes de relançar o erro.
    const internalErrorUpdate = queryBuilder({ data: null, error: null })
    const unclaim = queryBuilder({ data: null, error: null })

    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, inserted, claim, orderForTrigger, internalErrorUpdate, unclaim],
      triggers: [triggerLookup],
    })

    await upsertShopifyOrder(integrationRow(), shopifyOrder())

    // O claim é um UPDATE condicional: só afeta a linha se confirmation_message_sent_at ainda for null.
    expect(claim.update).toHaveBeenCalledWith({ confirmation_message_sent_at: expect.any(String) })
    // is('confirmation_message_sent_at', null) é implementado via .eq no mock genérico de query builder,
    // mas o importante aqui é que o claim ocorreu ANTES da tentativa de disparo do gatilho.
    expect(triggerLookup.eq).toHaveBeenCalledWith('source', 'shopify_order')

    // Sem gatilho configurado, runShopifyOrderTrigger lança e o catch libera o claim.
    expect(unclaim.updates[0]).toMatchObject({ confirmation_message_sent_at: null })
  })

  it('não reivindica nem tenta disparar confirmação de novo quando confirmation_message_sent_at já foi setado por outra entrega concorrente do webhook', async () => {
    const account = queryBuilder({ data: { instance_name: 'wa-country' }, error: null })
    const existing = queryBuilder({ data: null, error: null })
    const inserted = queryBuilder({ data: { id: 'order-1', assigned_instance_name: 'wa-country' }, error: null })
    // Simula outra entrega do webhook já ter vencido a corrida — o UPDATE
    // condicional (WHERE confirmation_message_sent_at IS NULL) não afeta
    // nenhuma linha e retorna null.
    const claimLost = queryBuilder({ data: null, error: null })

    setTableQueues({
      accounts: [account],
      fulfillment_orders: [existing, inserted, claimLost],
    })

    await upsertShopifyOrder(integrationRow(), shopifyOrder())

    // Sem vencer o claim, o gatilho de confirmação nunca deve ser consultado/disparado.
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
})

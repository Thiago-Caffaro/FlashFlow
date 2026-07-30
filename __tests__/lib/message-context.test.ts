export {}

const supabaseAdminMock = { from: jest.fn() }
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: supabaseAdminMock }))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result) {
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain
}

function setQueues(queues: Record<string, Record<string, jest.Mock | unknown>[]>) {
  const pending = new Map(Object.entries(queues))
  supabaseAdminMock.from.mockImplementation((table: string) => {
    const queue = pending.get(table)
    if (!queue?.length) throw new Error(`Unexpected table ${table}`)
    return queue.shift()
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrderContextPendingError, resolveMessageTemplateContext } = require('@/lib/message-context')

const conversation = {
  id: 'conv-1',
  instance_name: 'wa-1',
  wa_id: '34600000000@s.whatsapp.net',
  contact_name: 'Maria Silva',
  contact_phone: '34600000000',
}

const order = {
  id: 'order-1',
  instance_name: 'wa-1',
  assigned_instance_name: 'wa-1',
  conversation_id: null,
  items: [{
    product_id: 'product-1',
    shopify_variant_id: 'variant-1',
    sku: 'SKU-1',
    name: 'Produto original',
    quantity: 1,
    unit_price: 20,
    total: 20,
  }],
}

describe('resolveMessageTemplateContext', () => {
  beforeEach(() => jest.clearAllMocks())

  it('loads the exact order and product metadata only from local tables', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    setQueues({
      conversations: [builder({ data: conversation, error: null })],
      fulfillment_orders: [builder({ data: order, error: null })],
      shopify_products: [builder({
        data: [{ id: 'local-1', shopify_variant_id: 'variant-1', title: 'Produto local' }],
        error: null,
      })],
      message_variables: [builder({ data: [{ key: 'nome_loja', value: 'Loja' }], error: null })],
    })

    const context = await resolveMessageTemplateContext({
      instanceName: 'wa-1',
      conversationId: 'conv-1',
      remoteJid: conversation.wa_id,
      orderId: 'order-1',
      templates: ['{{pedido.produtos}} {{personalizada.nome_loja}}'],
    })

    expect(context.order).toMatchObject({ id: 'order-1' })
    expect(context.productsByVariantId?.get('variant-1')).toMatchObject({ title: 'Produto local' })
    expect(context.customVariables).toEqual({ nome_loja: 'Loja' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('falls back to the most recent order linked to the conversation', async () => {
    setQueues({
      conversations: [builder({ data: conversation, error: null })],
      fulfillment_orders: [builder({ data: { ...order, conversation_id: 'conv-1' }, error: null })],
      message_variables: [builder({ data: [], error: null })],
    })

    const context = await resolveMessageTemplateContext({
      instanceName: 'wa-1',
      conversationId: 'conv-1',
      remoteJid: conversation.wa_id,
      templates: ['{{pedido.total}}'],
    })
    expect(context.order).toMatchObject({ id: 'order-1' })
  })

  it('falls back to the newest local order for the same phone and account', async () => {
    setQueues({
      conversations: [builder({ data: conversation, error: null })],
      fulfillment_orders: [
        builder({ data: null, error: null }),
        builder({
          data: [
            { ...order, id: 'other-account', instance_name: 'wa-other', assigned_instance_name: 'wa-other' },
            order,
          ],
          error: null,
        }),
      ],
      message_variables: [builder({ data: [], error: null })],
    })

    const context = await resolveMessageTemplateContext({
      instanceName: 'wa-1',
      conversationId: 'conv-1',
      remoteJid: conversation.wa_id,
      templates: ['{{pedido.total}}'],
    })
    expect(context.order).toMatchObject({ id: 'order-1', instance_name: 'wa-1' })
  })

  it('keeps the node pending when no local order is available', async () => {
    setQueues({
      conversations: [builder({ data: conversation, error: null })],
      fulfillment_orders: [
        builder({ data: null, error: null }),
        builder({ data: [], error: null }),
      ],
    })

    await expect(resolveMessageTemplateContext({
      instanceName: 'wa-1',
      conversationId: 'conv-1',
      remoteJid: conversation.wa_id,
      templates: ['{{pedido.numero}}'],
    })).rejects.toBeInstanceOf(OrderContextPendingError)
  })
})

// lib/automation-runtime.ts: qual automação atende um carrinho e por qual
// número o lembrete sai na hora do envio.

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
const queried: string[] = []

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  const run = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return chain },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
  }
  return chain
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => { queried.push(table); return builder(table) } },
}))
const mockResolveLine = jest.fn()
const mockResolveCatalogLine = jest.fn()
jest.mock('@/lib/product-lines', () => ({
  resolveShopifyCartProductLine: (...args: unknown[]) => mockResolveLine(...args),
  resolveCatalogProductLine: (...args: unknown[]) => mockResolveCatalogLine(...args),
}))
const mockEnqueueDelivery = jest.fn()
jest.mock('@/lib/flow-jobs', () => ({
  enqueueDeliveryStatusAutomationJob: (...args: unknown[]) => mockEnqueueDelivery(...args),
}))

import {
  findMessageAutomation,
  findOrderAutomation,
  findShopifyCartAutomation,
  getEnabledAutomationInstance,
  scheduleDeliveryStatusAutomation,
} from '@/lib/automation-runtime'

const automation = (id: string, overrides: Row = {}) => ({
  id,
  name: id,
  kind: 'abandoned_cart',
  platform: 'shopify',
  country: 'ES',
  product_line_id: null,
  instance_name: `wa-${id}`,
  enabled: true,
  ...overrides,
})

beforeEach(() => {
  queried.length = 0
  mockResolveLine.mockReset()
  mockResolveCatalogLine.mockReset()
  mockEnqueueDelivery.mockReset()
  tables = {
    automations: [],
    automation_steps: [
      { id: 's1', automation_id: 'ema', position: 1, delay_minutes: 60, flow_id: 'flow-1' },
      { id: 's2', automation_id: 'ema', position: 2, delay_minutes: 1440, flow_id: null },
    ],
  }
})

describe('findShopifyCartAutomation', () => {
  it('sem automação ligada não resolve a linha do carrinho', async () => {
    tables.automations = [automation('off', { enabled: false })]
    await expect(findShopifyCartAutomation({ integrationId: 'shop-1', country: 'SPAIN', payload: {} })).resolves.toBeNull()
    expect(mockResolveLine).not.toHaveBeenCalled()
  })

  it('escolhe a automação da linha do carrinho e só leva lembretes com fluxo', async () => {
    tables.automations = [automation('any'), automation('ema', { product_line_id: 'line-ema' })]
    mockResolveLine.mockResolvedValue({ id: 'line-ema' })
    const payload = { line_items: [{ product_id: 1 }] }

    const match = await findShopifyCartAutomation({ integrationId: 'shop-1', country: 'SPAIN', payload })

    expect(mockResolveLine).toHaveBeenCalledWith('shop-1', payload)
    expect(match?.automation.id).toBe('ema')
    expect(match?.productLineId).toBe('line-ema')
    expect(match?.automation.steps.map((step) => step.id)).toEqual(['s1'])
  })

  it('carrinho sem produto vinculado cai na automação de qualquer linha', async () => {
    tables.automations = [automation('any'), automation('ema', { product_line_id: 'line-ema' })]
    mockResolveLine.mockResolvedValue(null)
    const match = await findShopifyCartAutomation({ integrationId: 'shop-1', country: 'SPAIN', payload: {} })
    expect(match?.automation.id).toBe('any')
  })
})

describe('getEnabledAutomationInstance', () => {
  it('devolve o número atual só de automação ligada', async () => {
    tables.automations = [automation('on'), automation('off', { enabled: false })]
    await expect(getEnabledAutomationInstance('on')).resolves.toBe('wa-on')
    await expect(getEnabledAutomationInstance('off')).resolves.toBeNull()
    await expect(getEnabledAutomationInstance('gone')).resolves.toBeNull()
  })
})

describe('automações de pedido e mensagem', () => {
  const orderAutomation = (id: string, overrides: Row = {}) => automation(id, { kind: 'order_created', ...overrides })

  it('pedido Lightfunnels resolve a linha pelos produtos do funil', async () => {
    tables.automations = [orderAutomation('ema', { platform: 'lightfunnels', product_line_id: 'line-ema' })]
    mockResolveCatalogLine.mockResolvedValue({ id: 'line-ema' })
    const match = await findOrderAutomation('order_created', {
      source: 'lightfunnels',
      country: 'SPAIN',
      lightfunnels_integration_id: 'lf-1',
      items: [{ lightfunnels_product_id: 'p1' }, { lightfunnels_product_id: 'p1' }],
    })
    expect(mockResolveCatalogLine).toHaveBeenCalledWith('lightfunnels', 'lf-1', ['p1'])
    expect(match?.automation.id).toBe('ema')
    expect(match?.step.flow_id).toBe('flow-1')
  })

  it('pedido manual nunca casa', async () => {
    tables.automations = [orderAutomation('any')]
    await expect(findOrderAutomation('order_created', { source: 'manual', country: 'SPAIN' })).resolves.toBeNull()
    expect(queried).not.toContain('automations')
  })

  it('agenda a entrega só para pedido real e com automação do novo status', async () => {
    tables.automations = [automation('ema', { kind: 'delivery_status', config: { statuses: ['Entregue'] } })]
    tables.automation_steps.push({ id: 's3', automation_id: 'ema', position: 1, delay_minutes: 0, flow_id: 'flow-d' })
    tables.fulfillment_orders = [
      { id: 'o1', is_simulation: false, source: 'shopify', country: 'SPAIN', shopify_integration_id: 'shop-1', raw_shopify_payload: {} },
      { id: 'o2', is_simulation: true, source: 'shopify', country: 'SPAIN', shopify_integration_id: 'shop-1' },
    ]
    mockResolveCatalogLine.mockResolvedValue(null)

    await expect(scheduleDeliveryStatusAutomation('o1', 'ev-1', 'A caminho')).resolves.toBe(false)
    await expect(scheduleDeliveryStatusAutomation('o2', 'ev-2', 'Entregue')).resolves.toBe(false)
    await expect(scheduleDeliveryStatusAutomation('o1', 'ev-3', 'Entregue')).resolves.toBe(true)
    expect(mockEnqueueDelivery).toHaveBeenCalledTimes(1)
    expect(mockEnqueueDelivery).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o1', eventId: 'ev-3', automationId: 'ema', instanceName: 'wa-ema', deliveryStatus: 'Entregue',
    }))
  })

  it('palavra-chave procura só no número da mensagem', async () => {
    tables.automations = [
      automation('outro', { kind: 'message_keyword', instance_name: 'wa-x', config: { keywords: 'preço' } }),
      automation('ema', { kind: 'message_keyword', instance_name: 'wa-es', config: { keywords: 'preço' } }),
    ]
    await expect(findMessageAutomation('wa-es', 'qual o preço?')).resolves.toMatchObject({ automation: { id: 'ema' } })
    await expect(findMessageAutomation('wa-es', 'bom dia')).resolves.toBeNull()
  })
})

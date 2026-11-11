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
jest.mock('@/lib/product-lines', () => ({
  resolveShopifyCartProductLine: (...args: unknown[]) => mockResolveLine(...args),
}))

import { findShopifyCartAutomation, getEnabledAutomationInstance } from '@/lib/automation-runtime'

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

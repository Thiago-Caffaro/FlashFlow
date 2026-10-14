export {}

type Result = { data: unknown; error: { message: string } | null }

// Query builder mínimo: cada chamada de from(tabela) consome o próximo
// resultado da fila daquela tabela.
const queues: Record<string, Result[]> = {}
const calls: Array<{ table: string; method: string; args: unknown[] }> = []

function builder(table: string) {
  const result = queues[table]?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'delete', 'insert']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args })
      return chain
    }
  }
  chain.then = (resolve: (value: Result) => unknown) => resolve(result)
  return chain
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pickShopifyStoreAccount, replaceShopifyStoreAccounts } = require('@/lib/shopify-store-accounts')

function links(rows: Array<{ instance_name: string; priority?: number; enabled?: boolean }>): Result {
  return { data: rows.map((row) => ({ priority: 100, enabled: true, ...row })), error: null }
}

describe('shopify-store-accounts', () => {
  beforeEach(() => {
    for (const key of Object.keys(queues)) delete queues[key]
    calls.length = 0
  })

  it('returns null when the store has no linked accounts (general rule applies)', async () => {
    queues.shopify_integration_accounts = [links([])]
    expect(await pickShopifyStoreAccount('store-1', 'SPAIN')).toBeNull()
  })

  it('prefers the linked account from the order country over a higher priority one', async () => {
    queues.shopify_integration_accounts = [links([
      { instance_name: 'wa-pt', priority: 1 },
      { instance_name: 'wa-es', priority: 5 },
    ])]
    queues.accounts = [{ data: [
      { instance_name: 'wa-pt', country: 'PORTUGAL', is_sandbox: false },
      { instance_name: 'wa-es', country: 'spain', is_sandbox: false },
    ], error: null }]

    expect(await pickShopifyStoreAccount('store-1', 'Spain')).toBe('wa-es')
  })

  it('falls back to the first linked account by priority when none matches the country', async () => {
    queues.shopify_integration_accounts = [links([
      { instance_name: 'wa-pt', priority: 1 },
      { instance_name: 'wa-it', priority: 5 },
    ])]
    queues.accounts = [{ data: [
      { instance_name: 'wa-pt', country: 'PORTUGAL', is_sandbox: false },
      { instance_name: 'wa-it', country: 'ITALY', is_sandbox: false },
    ], error: null }]

    expect(await pickShopifyStoreAccount('store-1', 'GERMANY')).toBe('wa-pt')
  })

  it('skips disabled, deleted and sandbox accounts', async () => {
    queues.shopify_integration_accounts = [links([
      { instance_name: 'wa-off', priority: 0, enabled: false },
      { instance_name: 'wa-gone', priority: 1 },
      { instance_name: '__sandbox__', priority: 2 },
      { instance_name: 'wa-ok', priority: 9 },
    ])]
    queues.accounts = [{ data: [
      { instance_name: '__sandbox__', country: 'SPAIN', is_sandbox: true },
      { instance_name: 'wa-ok', country: 'ITALY', is_sandbox: false },
    ], error: null }]

    expect(await pickShopifyStoreAccount('store-1', 'SPAIN')).toBe('wa-ok')
  })

  it('refuses to link an unknown or sandbox account', async () => {
    queues.accounts = [{ data: [{ instance_name: '__sandbox__', is_sandbox: true }], error: null }]

    await expect(replaceShopifyStoreAccounts('store-1', [
      { instance_name: '__sandbox__', priority: 1, enabled: true },
      { instance_name: 'wa-missing', priority: 2, enabled: true },
    ])).rejects.toThrow('Conta WhatsApp inválida: __sandbox__, wa-missing')
    expect(calls.some((call) => call.method === 'delete')).toBe(false)
  })

  it('replaces the links of the store', async () => {
    queues.accounts = [{ data: [{ instance_name: 'wa-es', is_sandbox: false }], error: null }]
    queues.shopify_integration_accounts = [
      { data: null, error: null },
      { data: null, error: null },
      links([{ instance_name: 'wa-es', priority: 3 }]),
    ]

    const result = await replaceShopifyStoreAccounts('store-1', [{ instance_name: 'wa-es', priority: 3.4, enabled: true }])

    const insert = calls.find((call) => call.method === 'insert')
    expect(insert?.args[0]).toEqual([{ integration_id: 'store-1', instance_name: 'wa-es', priority: 3, enabled: true }])
    expect(result).toEqual([{ instance_name: 'wa-es', priority: 3, enabled: true }])
  })
})

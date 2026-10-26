const mockFrom = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mockFrom } }))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order']) chain[method] = jest.fn(() => chain)
  chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

function setup(links: unknown[], accounts: unknown[]) {
  mockFrom.mockImplementation((table: string) => (
    table === 'lightfunnels_integration_accounts'
      ? builder({ data: links, error: null })
      : builder({ data: accounts, error: null })
  ))
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pickLightfunnelsStoreAccount } = require('@/lib/lightfunnels-store-accounts')

const accounts = [
  { instance_name: 'wa-generic', country: 'SPAIN', is_sandbox: false },
  { instance_name: 'wa-pt-funnel', country: 'PORTUGAL', is_sandbox: false },
  { instance_name: 'wa-es-funnel', country: 'SPAIN', is_sandbox: false },
]

describe('pickLightfunnelsStoreAccount', () => {
  beforeEach(() => jest.clearAllMocks())

  it('prefers an account dedicated to the order funnel over a generic one with higher priority', async () => {
    setup([
      { instance_name: 'wa-generic', priority: 1, enabled: true, funnel_ids: [] },
      { instance_name: 'wa-pt-funnel', priority: 50, enabled: true, funnel_ids: ['funnel-pt'] },
    ], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'SPAIN', 'funnel-pt')).resolves.toBe('wa-pt-funnel')
  })

  it('falls back to generic links for funnels without a dedicated account', async () => {
    setup([
      { instance_name: 'wa-generic', priority: 1, enabled: true, funnel_ids: [] },
      { instance_name: 'wa-pt-funnel', priority: 50, enabled: true, funnel_ids: ['funnel-pt'] },
    ], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'SPAIN', 'funnel-other')).resolves.toBe('wa-generic')
  })

  it('orders without a known funnel only match generic links', async () => {
    setup([{ instance_name: 'wa-pt-funnel', priority: 1, enabled: true, funnel_ids: ['funnel-pt'] }], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'PORTUGAL', null)).resolves.toBeNull()
  })

  it('prefers the order country among accounts dedicated to the same funnel', async () => {
    setup([
      { instance_name: 'wa-pt-funnel', priority: 1, enabled: true, funnel_ids: ['funnel-x'] },
      { instance_name: 'wa-es-funnel', priority: 50, enabled: true, funnel_ids: ['funnel-x'] },
    ], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'SPAIN', 'funnel-x')).resolves.toBe('wa-es-funnel')
  })

  it('falls back to generic links when the dedicated account no longer exists', async () => {
    setup([
      { instance_name: 'wa-deleted', priority: 1, enabled: true, funnel_ids: ['funnel-pt'] },
      { instance_name: 'wa-generic', priority: 5, enabled: true, funnel_ids: [] },
    ], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'SPAIN', 'funnel-pt')).resolves.toBe('wa-generic')
  })

  it('returns null (general rule) when nothing is linked', async () => {
    setup([], accounts)
    await expect(pickLightfunnelsStoreAccount('int-1', 'SPAIN', 'funnel-pt')).resolves.toBeNull()
  })
})

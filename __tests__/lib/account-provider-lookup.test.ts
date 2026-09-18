import { isCloudApiAccount } from '@/lib/account-provider-lookup'

// Formato real de GET /api/accounts (ver app/api/accounts/route.ts).
const accounts = [
  { instanceName: 'spain', label: 'Spain', state: 'open', provider: 'evolution' },
  { instanceName: 'casa-verde', label: 'Casa Verde - Colombia', state: 'open', provider: 'cloud_api' },
]

describe('isCloudApiAccount', () => {
  it('finds the account by instanceName and reads its provider', () => {
    expect(isCloudApiAccount(accounts, 'casa-verde')).toBe(true)
    expect(isCloudApiAccount(accounts, 'spain')).toBe(false)
  })

  it('is false for unknown accounts and for malformed responses', () => {
    expect(isCloudApiAccount(accounts, 'nao-existe')).toBe(false)
    expect(isCloudApiAccount(undefined, 'casa-verde')).toBe(false)
    expect(isCloudApiAccount({ error: 'x' }, 'casa-verde')).toBe(false)
    expect(isCloudApiAccount([null, 'x'], 'casa-verde')).toBe(false)
  })

  it('does not match the snake_case table column name (the bug this guards against)', () => {
    expect(isCloudApiAccount([{ instance_name: 'casa-verde', provider: 'cloud_api' }], 'casa-verde')).toBe(false)
  })
})

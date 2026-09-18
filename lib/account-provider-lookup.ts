import type { Account } from '@/types'

// GET /api/accounts devolve as contas em camelCase (instanceName, provider) —
// mesmo formato do tipo Account. Procurar por instance_name (snake_case, o
// formato da tabela) nunca acha a conta e a UI passa a tratar toda conta como
// não oficial.
export function isCloudApiAccount(accounts: unknown, instanceName: string): boolean {
  if (!Array.isArray(accounts)) return false
  const account = (accounts as Array<Partial<Account> | null>).find((item) => item?.instanceName === instanceName)
  return account?.provider === 'cloud_api'
}

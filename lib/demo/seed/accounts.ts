import type { Account } from '@/types'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const DEMO_INSTANCE_ES = 'loja-es'
export const DEMO_INSTANCE_PT = 'loja-pt'

// Contas inventadas. Os telefones usam prefixos que nenhuma operadora atribui.
export function seedAccounts(): Account[] {
  return [
    {
      instanceName: DEMO_INSTANCE_ES,
      label: 'Loja Espanha',
      state: 'open',
      profileName: 'Casa Brisa · España',
      profilePicUrl: null,
      phone: '34900555010',
      country: 'ES',
      confirmationEnabled: true,
      confirmationPriority: 10,
      isSandbox: false,
      provider: 'evolution',
    },
    {
      instanceName: DEMO_INSTANCE_PT,
      label: 'Loja Portugal (API oficial)',
      state: 'open',
      profileName: 'Casa Brisa · Portugal',
      profilePicUrl: null,
      phone: '351900555020',
      country: 'PT',
      confirmationEnabled: true,
      confirmationPriority: 20,
      isSandbox: false,
      provider: 'cloud_api',
    },
    {
      instanceName: SANDBOX_INSTANCE_NAME,
      label: 'Sandbox',
      state: 'open',
      profileName: null,
      profilePicUrl: null,
      phone: null,
      country: null,
      confirmationEnabled: false,
      confirmationPriority: 100,
      isSandbox: true,
      provider: 'evolution',
    },
  ]
}

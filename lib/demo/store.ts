import type { Account } from '@/types'
import { seedAccounts } from './seed/accounts'

// Estado em memória da demo. Nada é persistido: recarregar a página repõe
// os dados de exemplo.
export interface DemoStore {
  /** Contador para ids gerados durante a sessão. */
  seq: number
  accounts: Account[]
}

function createStore(): DemoStore {
  return {
    seq: 1000,
    accounts: seedAccounts(),
  }
}

let store: DemoStore | null = null

export function getStore(): DemoStore {
  if (!store) store = createStore()
  return store
}

export function resetStore(): void {
  store = null
}

export function nextId(target: DemoStore, prefix: string): string {
  target.seq += 1
  return `${prefix}-${target.seq}`
}

export const nowIso = (): string => new Date().toISOString()

/** Data ISO `minutes` minutos antes de agora — mantém os dados de exemplo sempre recentes. */
export const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()

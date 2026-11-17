// Estado em memória da demo. Nada é persistido: recarregar a página repõe
// os dados de exemplo.
export interface DemoStore {
  /** Contador para ids gerados durante a sessão. */
  seq: number
}

function createStore(): DemoStore {
  return { seq: 1000 }
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

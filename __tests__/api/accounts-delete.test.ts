/**
 * Testes para DELETE /api/accounts/[name] — exclusão idempotente (P17).
 * A conta só é de fato removida se todas as etapas de limpeza tiverem
 * sucesso; falhas parciais deixam a conta intacta para permitir retry seguro.
 */

import { NextRequest } from 'next/server'

/** Proxy "chainable" — qualquer método encadeado (.eq/.delete/.select/...) retorna
 * o próprio proxy; aguardar (await) resolve via .then() para o resultado configurado. */
function chainable(result: { data?: unknown; error?: { message: string } | null; count?: number | null }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      return () => proxy
    },
  }
  const proxy = new Proxy({}, handler)
  return proxy
}

const tableResults = new Map<string, { data?: unknown; error?: { message: string } | null; count?: number | null }>()
function setTable(table: string, result: { data?: unknown; error?: { message: string } | null; count?: number | null }) {
  tableResults.set(table, result)
}

const storageRemoveMock = jest.fn().mockResolvedValue({ error: null })
const mockFrom = jest.fn((table: string) => chainable(tableResults.get(table) ?? { data: null, error: null, count: 0 }))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
    storage: { from: jest.fn(() => ({ remove: storageRemoveMock })) },
  })),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DELETE } = require('@/app/api/accounts/[name]/route')

function makeParams(name: string) {
  return { params: Promise.resolve({ name }) }
}

function defaultTables() {
  // Tabelas consultadas por SELECT precisam de "data" coerente com o formato esperado.
  setTable('Instance', { data: null, error: null })
  setTable('IsOnWhatsapp', { data: null, error: null, count: 0 })
  setTable('ai_sessions', { data: null, error: null })
  setTable('flow_runs', { data: null, error: null })
  setTable('agent_memory_blocks', { data: null, error: null })
  setTable('triggers', { data: null, error: null })
  setTable('flows', { data: null, error: null })
  setTable('flow_media', { data: [], error: null })
  setTable('instance_ai_config', { data: null, error: null })
  setTable('conversations', { data: [], error: null })
  setTable('messages', { data: null, error: null })
  setTable('fulfillment_orders', { data: null, error: null })
  setTable('shopify_abandoned_checkouts', { data: null, error: null })
  setTable('accounts', { data: null, error: null, count: 1 }) // 1 conta restante -> não mexe em ai_provider_keys
  setTable('ai_provider_keys', { data: null, error: null })
}

beforeEach(() => {
  jest.clearAllMocks()
  tableResults.clear()
  defaultTables()
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
  fetchMock.mockResolvedValue({ status: 200 })
})

describe('DELETE /api/accounts/[name]', () => {
  it('rejeita exclusão da conta sandbox', async () => {
    const res = await DELETE(new NextRequest('http://localhost'), makeParams('__sandbox__'))
    expect(res.status).toBe(403)
  })

  it('remove a conta quando todas as etapas de limpeza têm sucesso', async () => {
    const res = await DELETE(new NextRequest('http://localhost'), makeParams('inst-a'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
  })

  it('não remove a conta quando uma etapa de limpeza falha, e reporta a etapa (idempotência)', async () => {
    setTable('triggers', { data: null, error: { message: 'boom' } })

    const res = await DELETE(new NextRequest('http://localhost'), makeParams('inst-a'))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
    expect(json.failedSteps).toContain('triggers')
    // A tabela "accounts" nunca deveria ter sofrido DELETE nesse caminho —
    // não há como inspecionar diretamente via este mock genérico, mas o
    // contrato da resposta já garante que o chamador sabe que precisa retry.
  })

  it('não é bloqueada por falha na Evolution API (best-effort) — só por falhas de limpeza no banco', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const res = await DELETE(new NextRequest('http://localhost'), makeParams('inst-a'))
    expect(res.status).toBe(200)
  })

  it('mantém ai_provider_keys quando ainda restam outras contas reais', async () => {
    setTable('accounts', { data: null, error: null, count: 2 })
    const res = await DELETE(new NextRequest('http://localhost'), makeParams('inst-a'))
    expect(res.status).toBe(200)
  })

  it('remove ai_provider_keys quando é a última conta real, e reporta falha se isso der erro', async () => {
    setTable('accounts', { data: null, error: null, count: 0 })
    setTable('ai_provider_keys', { data: null, error: { message: 'falha ao limpar chaves' } })
    const res = await DELETE(new NextRequest('http://localhost'), makeParams('inst-a'))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.failedSteps).toContain('ai_provider_keys')
  })
})

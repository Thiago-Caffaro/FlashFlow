import { NextRequest } from 'next/server'

const mockFrom = jest.fn()
const mockIsAdmin = jest.fn(() => true)

jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: () => mockIsAdmin(),
}))

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => mockFrom(table) },
}))

type QueryResult = { data: unknown; error: { message: string; code?: string } | null }

// Builder encadeável: qualquer método devolve o próprio builder e await
// resolve com `result`; guarda as chamadas para conferência.
function builder(result: QueryResult) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const target: Record<string, unknown> = {}
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(_obj, prop: string) {
      if (prop === 'calls') return calls
      if (prop === 'then') {
        return (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject)
      }
      if (prop === 'single' || prop === 'maybeSingle') return async () => result
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy as Record<string, unknown> & { calls: Array<{ method: string; args: unknown[] }> }
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/* eslint-disable @typescript-eslint/no-require-imports */
const linesRoute = require('@/app/api/product-lines/route')
const productsRoute = require('@/app/api/product-lines/products/route')
const linksRoute = require('@/app/api/product-lines/links/route')
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  mockFrom.mockReset()
  mockIsAdmin.mockReturnValue(true)
})

describe('POST /api/product-lines', () => {
  it('exige sessão administrativa', async () => {
    mockIsAdmin.mockReturnValue(false)
    const res = await linesRoute.POST(jsonRequest('http://localhost/api/product-lines', 'POST', { code: 'EMA' }))
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('cria a linha com código normalizado', async () => {
    const insert = builder({ data: { id: 'l-1', code: 'EMA' }, error: null })
    mockFrom.mockReturnValue(insert)
    const res = await linesRoute.POST(jsonRequest('http://localhost/api/product-lines', 'POST', { code: 'ema', priority: 10 }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(insert.calls[0]).toEqual({ method: 'insert', args: [{ code: 'EMA', name: 'EMA', priority: 10 }] })
  })

  it('código repetido vira 409 com mensagem legível', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { message: 'duplicate key', code: '23505' } }))
    const res = await linesRoute.POST(jsonRequest('http://localhost/api/product-lines', 'POST', { code: 'EMA' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Já existe uma linha com esse código')
  })

  it('valida antes de tocar no banco', async () => {
    const res = await linesRoute.POST(jsonRequest('http://localhost/api/product-lines', 'POST', { code: '  ' }))
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('POST /api/product-lines/products', () => {
  it('linha inexistente (FK) vira 404', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { message: 'fk', code: '23503' } }))
    const res = await productsRoute.POST(jsonRequest('http://localhost/api/product-lines/products', 'POST', {
      name: 'Lipogan',
      product_line_id: 'l-x',
    }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/product-lines/links', () => {
  const body = {
    line_product_id: 'p-1',
    platform: 'shopify',
    integration_id: 'int-1',
    external_product_id: '100',
    title: 'Lipogan 3 frascos',
  }

  it('rejeita plataforma inválida', async () => {
    const res = await linksRoute.POST(jsonRequest('http://localhost/api/product-lines/links', 'POST', { ...body, platform: 'woo' }))
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('loja inexistente vira 404 sem gravar vínculo', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'shopify_integrations') return builder({ data: null, error: null })
      throw new Error(`tabela inesperada ${table}`)
    })
    const res = await linksRoute.POST(jsonRequest('http://localhost/api/product-lines/links', 'POST', body))
    expect(res.status).toBe(404)
  })

  it('faz upsert pela chave da loja, movendo um vínculo existente', async () => {
    const upsert = builder({ data: { id: 'link-1' }, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'shopify_integrations') return builder({ data: { id: 'int-1' }, error: null })
      if (table === 'product_catalog_links') return upsert
      throw new Error(`tabela inesperada ${table}`)
    })
    const res = await linksRoute.POST(jsonRequest('http://localhost/api/product-lines/links', 'POST', body))
    expect(res.status).toBe(200)
    expect(upsert.calls[0]).toEqual({
      method: 'upsert',
      args: [body, { onConflict: 'platform,integration_id,external_product_id' }],
    })
  })
})

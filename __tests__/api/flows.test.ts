/** Testes para app/api/flows/route.ts — validação de schema no POST (P13). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/flows/route')

function req(body: unknown) {
  return new NextRequest('http://localhost/api/flows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockInsertSuccess() {
  supabaseMock.from.mockReturnValue({
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: 'flow-1' }, error: null }),
      }),
    }),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/flows', () => {
  it('cria um fluxo vazio (estado inicial padrão) com sucesso', async () => {
    mockInsertSuccess()
    const res = await POST(req({ instance_name: 'inst-a', name: 'Novo Fluxo' }))
    expect(res.status).toBe(200)
  })

  it('rejeita com 422 quando json enviado tem grafo inválido (aresta para nó inexistente)', async () => {
    const res = await POST(req({
      instance_name: 'inst-a',
      name: 'Fluxo malformado',
      json: { nodes: [{ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [{ id: 'e1', source: 'n1', target: 'fantasma' }] },
    }))
    expect(res.status).toBe(422)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 422 quando json enviado tem tipo de nó desconhecido', async () => {
    const res = await POST(req({
      instance_name: 'inst-a',
      json: { nodes: [{ id: 'n1', type: 'executeShellCommand', position: { x: 0, y: 0 }, data: {} }], edges: [] },
    }))
    expect(res.status).toBe(422)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 400 sem instance_name', async () => {
    const res = await POST(req({ name: 'x' }))
    expect(res.status).toBe(400)
  })
})

/**
 * Testes de isolamento por instance_name para app/api/flows/[id]/route.ts
 * (P6 da varredura de segurança — ver lib/instance-guard.ts).
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT, DELETE } = require('@/app/api/flows/[id]/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const FLOW_ID = 'flow-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function putReq(body: unknown) {
  return new NextRequest(`http://localhost/api/flows/${FLOW_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(instance?: string) {
  const url = instance
    ? `http://localhost/api/flows/${FLOW_ID}?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/flows/${FLOW_ID}`
  return new NextRequest(url, { method: 'DELETE' })
}

const updateMock = jest.fn()
const deleteMock = jest.fn()

/** Configura o mock para uma flow existente pertencente a `owningInstance`. */
function mockOwnedFlow(owningInstance: string | null, updateResult: { data: unknown; error: unknown } = { data: { id: FLOW_ID, instance_name: owningInstance, name: 'atualizado' }, error: null }) {
  updateMock.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue(updateResult),
      }),
    }),
  })
  deleteMock.mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  })

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'flows') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: owningInstance ? { instance_name: owningInstance } : null,
            }),
          }),
        }),
        update: updateMock,
        delete: deleteMock,
      }
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PUT /api/flows/[id] — isolamento por instância', () => {
  it('atualiza quando o flow pertence à instância informada (Instância A)', async () => {
    mockOwnedFlow(INSTANCE_A)
    const res = await PUT(putReq({ name: 'novo nome', instance_name: INSTANCE_A }), makeParams(FLOW_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando o flow pertence à Instância B mas o request diz Instância A', async () => {
    mockOwnedFlow(INSTANCE_B)
    const res = await PUT(putReq({ name: 'tentativa maliciosa', instance_name: INSTANCE_A }), makeParams(FLOW_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 404 quando o flow não existe', async () => {
    mockOwnedFlow(null)
    const res = await PUT(putReq({ name: 'x', instance_name: INSTANCE_A }), makeParams(FLOW_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 quando instance_name está ausente do corpo', async () => {
    const res = await PUT(putReq({ name: 'x' }), makeParams(FLOW_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 422 quando o json do fluxo é estruturalmente inválido (P13)', async () => {
    mockOwnedFlow(INSTANCE_A)
    const res = await PUT(
      putReq({
        instance_name: INSTANCE_A,
        json: { nodes: [{ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [{ id: 'e1', source: 'n1', target: 'fantasma' }] },
      }),
      makeParams(FLOW_ID)
    )
    expect(res.status).toBe(422)
    // A checagem de instância já rodou (from foi chamado), mas o update não deve ter sido efetuado com o json inválido.
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('não permite sobrescrever id/instance_name/created_at/updated_at via mass assignment', async () => {
    mockOwnedFlow(INSTANCE_A)
    await PUT(
      putReq({
        instance_name: INSTANCE_A,
        id: 'outro-id-forjado',
        created_at: '2000-01-01T00:00:00Z',
        name: 'nome legítimo',
      }),
      makeParams(FLOW_ID)
    )

    const patch = updateMock.mock.calls[0][0]
    expect(patch.id).toBeUndefined()
    expect(patch.instance_name).toBeUndefined()
    expect(patch.created_at).toBeUndefined()
    expect(patch.name).toBe('nome legítimo')
  })
})

describe('DELETE /api/flows/[id] — isolamento por instância', () => {
  it('apaga quando o flow pertence à instância informada', async () => {
    mockOwnedFlow(INSTANCE_A)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(FLOW_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando o flow pertence a outra instância', async () => {
    mockOwnedFlow(INSTANCE_B)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(FLOW_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 quando instance está ausente da query', async () => {
    const res = await DELETE(deleteReq(), makeParams(FLOW_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 404 para id válido em instância __sandbox__ quando a instância informada é diferente', async () => {
    mockOwnedFlow('__sandbox__')
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(FLOW_ID))
    expect(res.status).toBe(404)
  })
})

/** Testes de isolamento por instance_name para app/api/memory-blocks/[id]/route.ts (P6). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT, DELETE } = require('@/app/api/memory-blocks/[id]/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const BLOCK_ID = 'block-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function putReq(body: unknown) {
  return new NextRequest(`http://localhost/api/memory-blocks/${BLOCK_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(instance?: string) {
  const url = instance
    ? `http://localhost/api/memory-blocks/${BLOCK_ID}?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/memory-blocks/${BLOCK_ID}`
  return new NextRequest(url, { method: 'DELETE' })
}

const updateMock = jest.fn()
const deleteMock = jest.fn()

function mockOwnedBlock(owningInstance: string | null) {
  updateMock.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: BLOCK_ID, instance_name: owningInstance }, error: null }),
      }),
    }),
  })
  deleteMock.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'agent_memory_blocks') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: owningInstance ? { instance_name: owningInstance } : null }),
          }),
        }),
        update: updateMock,
        delete: deleteMock,
      }
    }
  })
}

beforeEach(() => jest.clearAllMocks())

describe('PUT /api/memory-blocks/[id] — isolamento', () => {
  it('atualiza quando pertence à instância informada', async () => {
    mockOwnedBlock(INSTANCE_A)
    const res = await PUT(putReq({ name: 'novo', instance_name: INSTANCE_A }), makeParams(BLOCK_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando pertence à Instância B', async () => {
    mockOwnedBlock(INSTANCE_B)
    const res = await PUT(putReq({ name: 'malicioso', instance_name: INSTANCE_A }), makeParams(BLOCK_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance_name', async () => {
    const res = await PUT(putReq({ name: 'x' }), makeParams(BLOCK_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/memory-blocks/[id] — isolamento', () => {
  it('apaga quando pertence à instância informada', async () => {
    mockOwnedBlock(INSTANCE_A)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(BLOCK_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando pertence a outra instância', async () => {
    mockOwnedBlock(INSTANCE_B)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(BLOCK_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance na query', async () => {
    const res = await DELETE(deleteReq(), makeParams(BLOCK_ID))
    expect(res.status).toBe(400)
  })
})

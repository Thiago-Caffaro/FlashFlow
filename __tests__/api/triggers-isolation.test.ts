/** Testes de isolamento por instance_name para app/api/triggers/[id]/route.ts (P6). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT, DELETE } = require('@/app/api/triggers/[id]/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const TRIGGER_ID = 'trig-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function putReq(body: unknown) {
  return new NextRequest(`http://localhost/api/triggers/${TRIGGER_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(instance?: string) {
  const url = instance
    ? `http://localhost/api/triggers/${TRIGGER_ID}?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/triggers/${TRIGGER_ID}`
  return new NextRequest(url, { method: 'DELETE' })
}

const updateMock = jest.fn()
const deleteMock = jest.fn()

function mockOwnedTrigger(owningInstance: string | null) {
  updateMock.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: TRIGGER_ID, instance_name: owningInstance }, error: null }),
      }),
    }),
  })
  deleteMock.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'triggers') {
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

describe('PUT /api/triggers/[id] — isolamento', () => {
  it('atualiza quando pertence à instância informada', async () => {
    mockOwnedTrigger(INSTANCE_A)
    const res = await PUT(putReq({ alias: 'novo', instance_name: INSTANCE_A }), makeParams(TRIGGER_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando pertence à Instância B', async () => {
    mockOwnedTrigger(INSTANCE_B)
    const res = await PUT(putReq({ alias: 'malicioso', instance_name: INSTANCE_A }), makeParams(TRIGGER_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance_name', async () => {
    const res = await PUT(putReq({ alias: 'x' }), makeParams(TRIGGER_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('não permite sobrescrever id/instance_name via mass assignment', async () => {
    mockOwnedTrigger(INSTANCE_A)
    await PUT(putReq({ instance_name: INSTANCE_A, id: 'forjado', alias: 'legítimo' }), makeParams(TRIGGER_ID))
    const patch = updateMock.mock.calls[0][0]
    expect(patch.id).toBeUndefined()
    expect(patch.instance_name).toBeUndefined()
    expect(patch.alias).toBe('legítimo')
  })
})

describe('DELETE /api/triggers/[id] — isolamento', () => {
  it('apaga quando pertence à instância informada', async () => {
    mockOwnedTrigger(INSTANCE_A)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(TRIGGER_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando pertence a outra instância', async () => {
    mockOwnedTrigger(INSTANCE_B)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(TRIGGER_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance na query', async () => {
    const res = await DELETE(deleteReq(), makeParams(TRIGGER_ID))
    expect(res.status).toBe(400)
  })
})

/** Testes de isolamento por instance_name para app/api/flow-media/[id]/route.ts (P6). */

import { NextRequest } from 'next/server'

const storageRemoveMock = jest.fn().mockResolvedValue({ error: null })
const supabaseMock = {
  from: jest.fn(),
  storage: { from: jest.fn(() => ({ remove: storageRemoveMock })) },
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PATCH, DELETE } = require('@/app/api/flow-media/[id]/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const MEDIA_ID = 'media-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function patchReq(body: unknown) {
  return new NextRequest(`http://localhost/api/flow-media/${MEDIA_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(instance?: string) {
  const url = instance
    ? `http://localhost/api/flow-media/${MEDIA_ID}?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/flow-media/${MEDIA_ID}`
  return new NextRequest(url, { method: 'DELETE' })
}

const updateMock = jest.fn()
const deleteMock = jest.fn()

function mockOwnedMedia(owningInstance: string | null) {
  updateMock.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: MEDIA_ID, filename: 'novo.jpg' }, error: null }),
      }),
    }),
  })
  deleteMock.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'flow_media') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: owningInstance
                ? { filename: 'atual.jpg', storage_path: 'path/atual.jpg', instance_name: owningInstance }
                : null,
            }),
          }),
        }),
        update: updateMock,
        delete: deleteMock,
      }
    }
  })
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/flow-media/[id] — isolamento', () => {
  it('renomeia quando pertence à instância informada', async () => {
    mockOwnedMedia(INSTANCE_A)
    const res = await PATCH(patchReq({ filename: 'novo', instance_name: INSTANCE_A }), makeParams(MEDIA_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando pertence à Instância B', async () => {
    mockOwnedMedia(INSTANCE_B)
    const res = await PATCH(patchReq({ filename: 'malicioso', instance_name: INSTANCE_A }), makeParams(MEDIA_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance_name', async () => {
    const res = await PATCH(patchReq({ filename: 'x' }), makeParams(MEDIA_ID))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/flow-media/[id] — isolamento', () => {
  it('apaga (arquivo + registro) quando pertence à instância informada', async () => {
    mockOwnedMedia(INSTANCE_A)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(MEDIA_ID))
    expect(res.status).toBe(200)
    expect(storageRemoveMock).toHaveBeenCalledWith(['path/atual.jpg'])
  })

  it('rejeita com 404 quando pertence a outra instância, e não remove o arquivo do storage', async () => {
    mockOwnedMedia(INSTANCE_B)
    const res = await DELETE(deleteReq(INSTANCE_A), makeParams(MEDIA_ID))
    expect(res.status).toBe(404)
    expect(storageRemoveMock).not.toHaveBeenCalled()
  })

  it('rejeita com 400 sem instance na query', async () => {
    const res = await DELETE(deleteReq(), makeParams(MEDIA_ID))
    expect(res.status).toBe(400)
  })
})

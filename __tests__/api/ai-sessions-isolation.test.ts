/** Testes de isolamento por instance_name para release/terminate de ai_sessions (P6). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PATCH: releasePATCH } = require('@/app/api/ai-sessions/[id]/release/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST: terminatePOST } = require('@/app/api/ai-sessions/[id]/terminate/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const SESSION_ID = 'sess-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
})

describe('PATCH /api/ai-sessions/[id]/release — isolamento', () => {
  function req(body: unknown) {
    return new NextRequest(`http://localhost/api/ai-sessions/${SESSION_ID}/release`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function mockSession(owningInstance: string | null) {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'ai_sessions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: owningInstance ? { instance_name: owningInstance } : null }),
            }),
          }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
    })
  }

  it('libera quando a sessão pertence à instância informada', async () => {
    mockSession(INSTANCE_A)
    const res = await releasePATCH(req({ instance_name: INSTANCE_A }), makeParams(SESSION_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando a sessão pertence à Instância B', async () => {
    mockSession(INSTANCE_B)
    const res = await releasePATCH(req({ instance_name: INSTANCE_A }), makeParams(SESSION_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance_name', async () => {
    const res = await releasePATCH(req({}), makeParams(SESSION_ID))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/ai-sessions/[id]/terminate — isolamento', () => {
  function req(body: unknown) {
    return new NextRequest(`http://localhost/api/ai-sessions/${SESSION_ID}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function mockSessionFound(owningInstance: string) {
    const deleteMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'ai_sessions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { id: SESSION_ID, instance_name: owningInstance, remote_jid: 'x@s.whatsapp.net', flow_id: 'flow-1' },
                error: null,
              }),
            }),
          }),
          delete: deleteMock,
        }
      }
    })
    return deleteMock
  }

  it('encerra quando o instance_name do body bate com o da sessão', async () => {
    const deleteMock = mockSessionFound(INSTANCE_A)
    const res = await terminatePOST(req({ message: '', useFlowMessage: false, instance_name: INSTANCE_A }), makeParams(SESSION_ID))
    expect(res.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
  })

  it('rejeita com 404 quando o instance_name do body não bate com o da sessão (Instância B tentando encerrar sessão da A)', async () => {
    const deleteMock = mockSessionFound(INSTANCE_A)
    const res = await terminatePOST(req({ message: '', useFlowMessage: false, instance_name: INSTANCE_B }), makeParams(SESSION_ID))
    expect(res.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('rejeita com 404 quando instance_name está ausente do body', async () => {
    const deleteMock = mockSessionFound(INSTANCE_A)
    const res = await terminatePOST(req({ message: '', useFlowMessage: false }), makeParams(SESSION_ID))
    expect(res.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

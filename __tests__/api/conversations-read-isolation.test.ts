/** Testes de isolamento por instance_name para app/api/conversations/[id]/read/route.ts (P6). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const fetchMock = jest.fn().mockResolvedValue({ ok: true })
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/conversations/[id]/read/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const CONV_ID = 'conv-123'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function req(instance?: string) {
  const url = instance
    ? `http://localhost/api/conversations/${CONV_ID}/read?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/conversations/${CONV_ID}/read`
  return new NextRequest(url, { method: 'POST' })
}

function mockConversation(owningInstance: string | null, unreadCount = 2) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: owningInstance
                ? { id: CONV_ID, wa_id: 'x@s.whatsapp.net', instance_name: owningInstance, unread_count: unreadCount }
                : null,
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              neq: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              neq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      }
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
})

describe('POST /api/conversations/[id]/read — isolamento', () => {
  it('marca como lida quando a conversa pertence à instância informada', async () => {
    mockConversation(INSTANCE_A)
    const res = await POST(req(INSTANCE_A), makeParams(CONV_ID))
    expect(res.status).toBe(200)
  })

  it('rejeita com 404 quando a conversa pertence à Instância B', async () => {
    mockConversation(INSTANCE_B)
    const res = await POST(req(INSTANCE_A), makeParams(CONV_ID))
    expect(res.status).toBe(404)
  })

  it('rejeita com 400 sem instance na query', async () => {
    const res = await POST(req(), makeParams(CONV_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 404 quando a conversa não existe', async () => {
    mockConversation(null)
    const res = await POST(req(INSTANCE_A), makeParams(CONV_ID))
    expect(res.status).toBe(404)
  })
})

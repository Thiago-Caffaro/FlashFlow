/** Testes de isolamento por instance_name para app/api/messages/sync/[conversationId]/route.ts (P6). */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/messages/sync/[conversationId]/route')

const INSTANCE_A = 'instance-a'
const INSTANCE_B = 'instance-b'
const CONV_ID = 'conv-123'

function makeParams(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) }
}

function req(instance?: string) {
  const url = instance
    ? `http://localhost/api/messages/sync/${CONV_ID}?instance=${encodeURIComponent(instance)}`
    : `http://localhost/api/messages/sync/${CONV_ID}`
  return new NextRequest(url, { method: 'POST' })
}

function mockConversation(owningInstance: string | null) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: owningInstance ? { wa_id: 'x@s.whatsapp.net', instance_name: owningInstance } : null,
            }),
          }),
        }),
      }
    }
    if (table === 'Instance') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }
    }
  })
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/messages/sync/[conversationId] — isolamento', () => {
  it('rejeita com 400 sem instance na query, sem consultar o banco', async () => {
    const res = await POST(req(), makeParams(CONV_ID))
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('não sincroniza (added: 0) quando a conversa pertence à Instância B mas o request diz Instância A', async () => {
    mockConversation(INSTANCE_B)
    const res = await POST(req(INSTANCE_A), makeParams(CONV_ID))
    const json = await res.json()
    expect(json).toEqual({ ok: false, added: 0 })
  })

  it('segue o fluxo normal quando a conversa pertence à instância informada', async () => {
    mockConversation(INSTANCE_A)
    const res = await POST(req(INSTANCE_A), makeParams(CONV_ID))
    const json = await res.json()
    // Instance lookup mockado retorna null -> instanceId null -> added: 0, mas SEM o bloqueio de isolamento
    expect(json).toEqual({ ok: true, added: 0 })
  })
})

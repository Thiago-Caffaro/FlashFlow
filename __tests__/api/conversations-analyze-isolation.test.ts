/**
 * Testes de isolamento por instance_name para app/api/conversations/analyze/route.ts
 * (P6 / seção 14.1 da varredura de segurança).
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

jest.mock('@/lib/ai-crypto', () => ({
  decrypt: jest.fn(() => 'decrypted-api-key'),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/conversations/analyze/route')

const INSTANCE_A = 'instance-a'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/conversations/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockKeysAndConversations(conversationRows: { id: string }[]) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'ai_provider_keys') {
      return {
        select: jest.fn().mockResolvedValue({
          data: [{ provider: 'gemini', encrypted_key: 'x', iv: 'x', auth_tag: 'x', custom_model: null }],
        }),
      }
    }
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: conversationRows }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: [{ content: 'oi', direction: 'inbound' }] }),
                }),
              }),
            }),
          }),
        }),
      }
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ analysis: 'ok', suggestions: [] }) }] } }],
    }),
  })
})

describe('POST /api/conversations/analyze — isolamento por instância', () => {
  it('analisa quando todos os conversation_ids pertencem à instância informada', async () => {
    mockKeysAndConversations([{ id: 'c1' }, { id: 'c2' }])
    const res = await POST(req({
      instance_name: INSTANCE_A,
      conversation_ids: ['c1', 'c2'],
      user_goal: 'melhorar atendimento',
    }))
    expect(res.status).toBe(200)
  })

  it('rejeita quando um dos conversation_ids não pertence à instância informada (mistura A/B)', async () => {
    // Banco só devolve c1 (que pertence à instância A) — c2 pertence à
    // Instância B e a query .eq('instance_name', ...) já o excluiu.
    mockKeysAndConversations([{ id: 'c1' }])
    const res = await POST(req({
      instance_name: INSTANCE_A,
      conversation_ids: ['c1', 'c2'],
      user_goal: 'melhorar atendimento',
    }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/1 conversa/)
  })

  it('rejeita quando nenhum conversation_id pertence à instância informada', async () => {
    mockKeysAndConversations([])
    const res = await POST(req({
      instance_name: INSTANCE_A,
      conversation_ids: ['c-de-outra-instancia'],
      user_goal: 'melhorar atendimento',
    }))
    expect(res.status).toBe(400)
  })

  it('rejeita sem instance_name', async () => {
    const res = await POST(req({ conversation_ids: ['c1'], user_goal: 'x' }))
    expect(res.status).toBe(400)
  })

  it('rejeita sem conversation_ids', async () => {
    const res = await POST(req({ instance_name: INSTANCE_A, user_goal: 'x' }))
    expect(res.status).toBe(400)
  })
})

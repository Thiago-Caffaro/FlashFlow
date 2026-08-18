/**
 * Testes para lib/messaging-window.ts — janela de 24h da WhatsApp Cloud API,
 * calculada sobre conversations.last_inbound_at (nunca last_message_at, que
 * é sobrescrito por envios nossos também e reabriria a janela indevidamente).
 */
export {}

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isWithinMessagingWindow, OutsideMessagingWindowError } = require('@/lib/messaging-window')

function mockConversation(lastInboundAt: string | null, error: { message: string } | null = null) {
  supabaseMock.from.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: lastInboundAt ? { last_inbound_at: lastInboundAt } : null, error }),
      }),
    }),
  })
}

describe('isWithinMessagingWindow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns true when the last inbound message was under 24h ago', async () => {
    mockConversation(new Date(Date.now() - 60 * 60 * 1000).toISOString()) // 1h atrás
    expect(await isWithinMessagingWindow('conv-1')).toBe(true)
  })

  it('returns false when the last inbound message was over 24h ago', async () => {
    mockConversation(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()) // 25h atrás
    expect(await isWithinMessagingWindow('conv-1')).toBe(false)
  })

  it('returns false when the conversation never received an inbound message', async () => {
    mockConversation(null)
    expect(await isWithinMessagingWindow('conv-1')).toBe(false)
  })

  it('returns false (fails closed) on a query error', async () => {
    mockConversation(null, { message: 'db down' })
    expect(await isWithinMessagingWindow('conv-1')).toBe(false)
  })

  it('returns false for a malformed timestamp instead of throwing', async () => {
    mockConversation('not-a-date')
    expect(await isWithinMessagingWindow('conv-1')).toBe(false)
  })
})

describe('OutsideMessagingWindowError', () => {
  it('carries the conversation id and a readable message', () => {
    const error = new OutsideMessagingWindowError('conv-1')
    expect(error.conversationId).toBe('conv-1')
    expect(error.name).toBe('OutsideMessagingWindowError')
    expect(error.message).toContain('24h')
  })
})

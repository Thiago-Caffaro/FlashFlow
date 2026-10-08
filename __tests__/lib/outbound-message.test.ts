export {}

const mockFrom = jest.fn()
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mockFrom } }))

type Result = { data?: unknown; error: { message: string; code?: string } | null }

function builder(result: Result = { data: null, error: null }) {
  const calls = { inserted: [] as unknown[], updated: [] as unknown[], deleted: 0 }
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit']) chain[method] = jest.fn(() => chain)
  chain.insert = jest.fn((value: unknown) => { calls.inserted.push(value); return chain })
  chain.update = jest.fn((value: unknown) => { calls.updated.push(value); return chain })
  chain.delete = jest.fn(() => { calls.deleted += 1; return chain })
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { chain: chain as Record<string, jest.Mock>, calls }
}

function queue(...builders: ReturnType<typeof builder>[]) {
  mockFrom.mockImplementation(() => {
    const next = builders.shift()
    if (!next) throw new Error('consulta inesperada')
    return next.chain
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { attachEchoToPendingOutbound, finalizePendingOutbound, recordOutboundMessage } = require('@/lib/outbound-message')

const duplicate = { message: 'duplicate key value violates unique constraint "messages_wa_message_id_key"', code: '23505' }

describe('outbound message race with the webhook echo', () => {
  beforeEach(() => jest.clearAllMocks())

  it('webhook echo attaches the WhatsApp id to the pending "sending" row instead of creating a second one', async () => {
    const pendingLookup = builder({ data: { id: 'pending-1' }, error: null })
    const attach = builder({ data: { id: 'pending-1' }, error: null })
    queue(pendingLookup, attach)

    const attached = await attachEchoToPendingOutbound({ conversationId: 'conv-1', waMessageId: 'WA1', content: 'Pedido confirmado', type: 'text' })

    expect(attached).toBe(true)
    expect(pendingLookup.chain.eq).toHaveBeenCalledWith('status', 'sending')
    expect(pendingLookup.chain.is).toHaveBeenCalledWith('wa_message_id', null)
    expect(pendingLookup.chain.eq).toHaveBeenCalledWith('content', 'Pedido confirmado')
    expect(attach.calls.updated[0]).toEqual({ wa_message_id: 'WA1', status: 'sent' })
    // Só anexa se ainda não tiver id (outra corrida pode ter anexado antes)
    expect(attach.chain.is).toHaveBeenCalledWith('wa_message_id', null)
  })

  it('matches pending images by type only — the echo URL differs from the uploaded one', async () => {
    const pendingLookup = builder({ data: null, error: null })
    queue(pendingLookup)

    await attachEchoToPendingOutbound({ conversationId: 'conv-1', waMessageId: 'WA2', content: 'https://cdn/x.jpg', type: 'image' })

    expect(pendingLookup.chain.eq).toHaveBeenCalledWith('type', 'image')
    expect(pendingLookup.chain.eq).not.toHaveBeenCalledWith('content', expect.anything())
  })

  it('send route: when the echo already created its own row, the pending duplicate is removed and the echo row returned', async () => {
    const update = builder({ data: null, error: duplicate })
    const echoLookup = builder({ data: { id: 'echo-row', wa_message_id: 'WA3', status: 'sent' }, error: null })
    const removal = builder({ error: null })
    queue(update, echoLookup, removal)

    const message = await finalizePendingOutbound('pending-1', 'WA3')

    expect(message).toMatchObject({ id: 'echo-row' })
    expect(removal.calls.deleted).toBe(1)
    expect(removal.chain.eq).toHaveBeenCalledWith('id', 'pending-1')
  })

  it('flow engine: on duplicate id only fixes authorship on the echo row (never re-sends, never throws)', async () => {
    const insert = builder({ error: duplicate })
    const fixAuthor = builder({ error: null })
    queue(insert, fixAuthor)

    await recordOutboundMessage({
      conversation_id: 'conv-1', wa_message_id: 'WA4', content: 'Olá', type: 'text', direction: 'outbound', status: 'sent', sender_type: 'ai',
    })

    expect(fixAuthor.calls.updated[0]).toEqual({ sender_type: 'ai' })
    expect(fixAuthor.chain.eq).toHaveBeenCalledWith('wa_message_id', 'WA4')
  })

  it('logs (does not throw) when a sent message cannot be recorded for another reason', async () => {
    queue(builder({ error: { message: 'connection reset', code: '08006' } }))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(recordOutboundMessage({
      conversation_id: 'conv-1', wa_message_id: 'WA5', content: 'Olá', type: 'text', direction: 'outbound', status: 'sent', sender_type: 'ai',
    })).resolves.toBeUndefined()

    expect(errorSpy.mock.calls[0][0]).toContain('mensagem enviada mas não registrada no histórico')
    expect(errorSpy.mock.calls[0][0]).toContain('code=08006')
    errorSpy.mockRestore()
  })
})

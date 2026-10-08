export {}

const mockFrom = jest.fn()
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mockFrom } }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EvolutionHistoryError, evolutionRemoteJidFilter, importEvolutionHistory } = require('@/lib/evolution-history')

function evoRow(id: string, message: Record<string, unknown>, ts: number) {
  return { key: { id, fromMe: false, remoteJid: 'abc@lid', remoteJidAlt: '34600000000@s.whatsapp.net' }, message, messageTimestamp: ts, status: 'DELIVERY_ACK' }
}

function setup(rows: unknown[], options: { conflicts?: number; insertError?: { message: string; code: string } } = {}) {
  const or = jest.fn(() => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }))
  const upsert = jest.fn((toInsert: unknown[], _options?: unknown) => ({
    select: async () => options.insertError
      ? { data: null, error: options.insertError }
      : { data: toInsert.slice(0, toInsert.length - (options.conflicts ?? 0)).map((_, i) => ({ id: `m${i}` })), error: null },
  }))
  let messagesCall = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'Message') return { select: () => ({ eq: () => ({ or }) }) }
    messagesCall += 1
    if (messagesCall === 1) return { select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }
    return { upsert }
  })
  return { or, upsert }
}

describe('importEvolutionHistory', () => {
  beforeEach(() => jest.clearAllMocks())

  it('finds history the Evolution stored under @lid by also matching remoteJidAlt / senderPn', () => {
    expect(evolutionRemoteJidFilter('34600000000@s.whatsapp.net')).toBe(
      'key->>remoteJid.eq."34600000000@s.whatsapp.net",key->>remoteJidAlt.eq."34600000000@s.whatsapp.net",key->>senderPn.eq."34600000000@s.whatsapp.net"'
    )
  })

  it('imports in chronological order, skips reactions, and reports rows that already live in another conversation', async () => {
    const { upsert } = setup([
      evoRow('B', { conversation: 'segunda' }, 200),
      evoRow('R', { reactionMessage: { text: '👍' } }, 150),
      evoRow('A', { ephemeralMessage: { message: { conversation: 'primeira' } } }, 100),
    ], { conflicts: 1 })

    const result = await importEvolutionHistory({ conversationId: 'conv-1', instanceId: 'inst-1', remoteJid: '34600000000@s.whatsapp.net' })

    const rows = upsert.mock.calls[0][0] as Array<{ wa_message_id: string; content: string }>
    expect(rows.map((row) => row.content)).toEqual(['primeira', 'segunda'])
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'wa_message_id', ignoreDuplicates: true })
    expect(result).toEqual({ found: 3, added: 1, alreadyElsewhere: 1, ignored: 1, unknownFormat: 0 })
  })

  it('throws (instead of reporting success) when the insert fails', async () => {
    setup([evoRow('A', { conversation: 'oi' }, 100)], { insertError: { message: 'permission denied', code: '42501' } })

    await expect(importEvolutionHistory({ conversationId: 'conv-1', instanceId: 'inst-1', remoteJid: '34600000000@s.whatsapp.net' }))
      .rejects.toBeInstanceOf(EvolutionHistoryError)
  })
})

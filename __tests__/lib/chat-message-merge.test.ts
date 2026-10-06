import type { Message } from '@/types'
import { mergeFetchedMessages } from '@/lib/chat-message-merge'

function message(id: string, minute: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: 'conv-1',
    wa_message_id: null,
    content: `msg ${id}`,
    type: 'text',
    direction: 'inbound',
    status: 'received',
    sender_type: null,
    created_at: `2026-10-02T10:${String(minute).padStart(2, '0')}:00.000Z`,
    ...overrides,
  }
}

describe('mergeFetchedMessages', () => {
  it('keeps older history and updates recent messages in place on a partial poll', () => {
    const prev = [
      message('m1', 1),
      message('m2', 2, { direction: 'outbound', status: 'sent' }),
    ]
    const fetched = [
      message('m2', 2, { direction: 'outbound', status: 'read' }),
      message('m3', 3),
    ]

    const merged = mergeFetchedMessages(prev, fetched, true)

    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(merged[1].status).toBe('read')
  })

  it('replaces everything on a full fetch', () => {
    const merged = mergeFetchedMessages([message('old', 1)], [message('m2', 2)], false)
    expect(merged.map((m) => m.id)).toEqual(['m2'])
  })

  it('drops an optimistic message once the confirmed one arrives, keeps it while still pending', () => {
    const optimistic = message('temp-1', 5, { direction: 'outbound', status: 'sending', content: 'oi' })
    const otherPending = message('temp-2', 6, { direction: 'outbound', status: 'sending', content: 'tchau' })
    const confirmed = message('m5', 5, { direction: 'outbound', status: 'sent', content: 'oi' })

    const merged = mergeFetchedMessages([message('m1', 1), optimistic, otherPending], [confirmed], true)

    expect(merged.map((m) => m.id)).toEqual(['m1', 'm5', 'temp-2'])
  })

  it('ignores an empty response instead of wiping the conversation', () => {
    const prev = [message('m1', 1)]
    expect(mergeFetchedMessages(prev, [], true)).toBe(prev)
  })
})

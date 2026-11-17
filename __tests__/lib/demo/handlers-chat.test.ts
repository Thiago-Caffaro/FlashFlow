import { registerDemoHandlers } from '@/lib/demo/handlers'
import { dispatch } from '@/lib/demo/router'
import { resetStore } from '@/lib/demo/store'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from '@/lib/demo/seed/accounts'
import type { AppNotification, Conversation, Message } from '@/types'

const listConversations = async (instance: string) =>
  (await dispatch('GET', `/api/conversations?instance=${instance}`, undefined)).json.conversations as Conversation[]

const listMessages = async (conversation: Conversation, extra = '') =>
  (await dispatch('GET', `/api/messages?conversationId=${conversation.id}&instance=${conversation.instance_name}${extra}`, undefined))
    .json.messages as Message[]

describe('demo: chats', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => {
    jest.useFakeTimers()
    resetStore()
  })
  afterEach(() => jest.useRealTimers())

  it('tem 8 conversas repartidas pelas duas contas, da mais recente para a mais antiga', async () => {
    const es = await listConversations(DEMO_INSTANCE_ES)
    const pt = await listConversations(DEMO_INSTANCE_PT)
    expect(es.length + pt.length).toBe(8)
    expect(es.length).toBeGreaterThan(0)
    expect(pt.length).toBeGreaterThan(0)
    const times = es.map((c) => Date.parse(c.last_message_at ?? ''))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('devolve o histórico em ordem cronológica e respeita ?recent', async () => {
    const [conversation] = await listConversations(DEMO_INSTANCE_ES)
    const all = await listMessages(conversation)
    expect(all.length).toBeGreaterThan(2)
    const times = all.map((m) => Date.parse(m.created_at))
    expect(times).toEqual([...times].sort((a, b) => a - b))
    const recent = await listMessages(conversation, '&recent=2')
    expect(recent.map((m) => m.id)).toEqual(all.slice(-2).map((m) => m.id))
  })

  it('enviar acrescenta a mensagem e o cliente simulado responde pouco depois', async () => {
    const before = await listConversations(DEMO_INSTANCE_ES)
    const target = before[before.length - 1]
    const sent = await dispatch('POST', '/api/messages', { conversationId: target.id, content: 'Hola, ¿sigue interesada?' })
    const message = sent.json.message as Message
    expect(message).toMatchObject({ direction: 'outbound', content: 'Hola, ¿sigue interesada?', sender_type: 'human', status: 'sent' })

    const countAfterSend = (await listMessages(target)).length
    jest.advanceTimersByTime(10_000)
    const after = await listMessages(target)
    expect(after).toHaveLength(countAfterSend + 1)
    const reply = after[after.length - 1]
    expect(reply.direction).toBe('inbound')
    expect(reply.content.length).toBeGreaterThan(0)

    const [top] = await listConversations(DEMO_INSTANCE_ES)
    expect(top.id).toBe(target.id)
    expect(top.last_message).toBe(reply.content)
  })

  it('recusa enviar para uma conversa desconhecida ou sem texto', async () => {
    expect((await dispatch('POST', '/api/messages', { conversationId: 'x', content: 'oi' })).status).toBe(404)
    const [conversation] = await listConversations(DEMO_INSTANCE_PT)
    expect((await dispatch('POST', '/api/messages', { conversationId: conversation.id, content: '' })).status).toBe(400)
  })

  it('aceita imagem por FormData', async () => {
    const [conversation] = await listConversations(DEMO_INSTANCE_PT)
    const form = new FormData()
    form.append('conversationId', conversation.id)
    form.append('file', new Blob(['x'], { type: 'image/png' }), 'foto.png')
    const result = await dispatch('POST', '/api/messages/image', form)
    expect(result.json.message).toMatchObject({ type: 'image', direction: 'outbound' })
  })

  it('marcar como lida zera as não lidas', async () => {
    const unread = (await listConversations(DEMO_INSTANCE_ES)).find((c) => c.unread_count > 0)
    expect(unread).toBeDefined()
    await dispatch('POST', `/api/conversations/${unread!.id}/read?instance=${DEMO_INSTANCE_ES}`, undefined)
    const again = (await listConversations(DEMO_INSTANCE_ES)).find((c) => c.id === unread!.id)
    expect(again!.unread_count).toBe(0)
  })

  it('notificações: contar, marcar como lidas e apagar', async () => {
    const path = `/api/notifications?instance=${DEMO_INSTANCE_ES}`
    const first = await dispatch('GET', path, undefined)
    const notifications = first.json.notifications as AppNotification[]
    expect(notifications.length).toBeGreaterThan(0)
    expect(first.json.unreadCount).toBeGreaterThan(0)
    expect((await dispatch('GET', `${path}&countOnly=1`, undefined)).json).toEqual({ ok: true, unreadCount: first.json.unreadCount })
    await dispatch('PATCH', '/api/notifications', { instance: DEMO_INSTANCE_ES })
    expect((await dispatch('GET', path, undefined)).json.unreadCount).toBe(0)
    await dispatch('DELETE', `${path}&id=${notifications[0].id}`, undefined)
    expect(((await dispatch('GET', path, undefined)).json.notifications as AppNotification[]).length).toBe(notifications.length - 1)
  })
})

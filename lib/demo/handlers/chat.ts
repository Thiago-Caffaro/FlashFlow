import type { Conversation, Message, MessageVariable } from '@/types'
import { nowIso } from '../clock'
import { blocked, bodyOf, fail, ok, route } from '../router'
import { scheduleCustomerReply } from '../simulated-customer'
import { nextId, type DemoStore } from '../store'

const byRecency = (a: Conversation, b: Conversation) =>
  Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at)

function appendOutbound(store: DemoStore, conversation: Conversation, content: string, type: string, preview: string): Message {
  const createdAt = nowIso()
  const message: Message = {
    id: nextId(store, 'msg'),
    conversation_id: conversation.id,
    wa_message_id: null,
    content,
    type,
    direction: 'outbound',
    status: 'sent',
    sender_type: 'human',
    created_at: createdAt,
  }
  store.messages.push(message)
  conversation.last_message = preview
  conversation.last_message_at = createdAt
  conversation.updated_at = createdAt
  scheduleCustomerReply(store, conversation.id)
  return message
}

function patchVariable(id: string, body: Record<string, unknown>, store: DemoStore) {
  const variable = store.messageVariables.find((v) => v.id === id)
  if (!variable) return fail('Variável não encontrada', 404)
  if (typeof body.key === 'string') variable.key = body.key
  if (typeof body.label === 'string') variable.label = body.label
  if (typeof body.value === 'string') variable.value = body.value
  variable.updated_at = nowIso()
  return ok({ variable })
}

export function registerChatHandlers(): void {
  route('GET', '/api/conversations', (req, store) => {
    const instance = req.query.get('instance')
    if (!instance) return fail('instance required')
    return ok({ conversations: store.conversations.filter((c) => c.instance_name === instance).sort(byRecency) })
  })

  route('POST', '/api/conversations/:id/read', (req, store) => {
    const conversation = store.conversations.find((c) => c.id === req.params.id)
    const updated = conversation?.unread_count ?? 0
    if (conversation) conversation.unread_count = 0
    return ok({ updated })
  })

  // Análise de conversa usa um modelo de IA real.
  route('POST', '/api/conversations/analyze', () => blocked())

  route('GET', '/api/messages', (req, store) => {
    const conversationId = req.query.get('conversationId')
    if (!conversationId) return fail('conversationId required')
    if (!store.conversations.some((c) => c.id === conversationId)) return fail('conversation not found', 404)
    const all = store.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const recent = Number(req.query.get('recent'))
    return ok({ messages: Number.isInteger(recent) && recent > 0 ? all.slice(-recent) : all })
  })

  route('POST', '/api/messages', (req, store) => {
    const body = bodyOf(req)
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content || typeof body.conversationId !== 'string') return fail('Campos obrigatórios ausentes')
    const conversation = store.conversations.find((c) => c.id === body.conversationId)
    if (!conversation) return fail('Conversa não encontrada', 404)
    return ok({ message: appendOutbound(store, conversation, content, 'text', content) })
  })

  route('POST', '/api/messages/image', (req, store) => {
    if (!(req.body instanceof FormData)) return fail('Campos obrigatórios ausentes')
    const conversationId = req.body.get('conversationId')
    const file = req.body.get('file')
    const conversation = store.conversations.find((c) => c.id === conversationId)
    if (!conversation) return fail('Conversa não encontrada', 404)
    if (!(file instanceof Blob)) return fail('Campos obrigatórios ausentes')
    // A imagem fica só neste separador, como URL local.
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : 'blob:demo'
    return ok({ message: appendOutbound(store, conversation, url, 'image', '[imagem]') })
  })

  // Sincronizar histórico com o WhatsApp: nada a acrescentar.
  route('POST', '/api/messages/sync/:conversationId', () => ok({ added: 0 }))

  // ── Sessões de IA ──────────────────────────────────────────────────────
  route('GET', '/api/ai-sessions', (req, store) => {
    const instance = req.query.get('instance')
    const sessions = store.aiSessions
      .filter((session) => session.instance_name === instance)
      .flatMap((session) => {
        const conversation = store.conversations.find((c) => c.instance_name === instance && c.wa_id === session.remote_jid)
        if (!conversation) return []
        const flow = store.flows.find((f) => f.id === session.flow_id)
        return [{ session, conversation, flow_name: flow?.name ?? null }]
      })
    return ok({ sessions })
  })

  route('POST', '/api/ai-sessions/:id/terminate', (req, store) => {
    store.aiSessions = store.aiSessions.filter((session) => session.id !== req.params.id)
    return ok()
  })

  route('POST', '/api/ai-sessions/:id/release', (req, store) => {
    const session = store.aiSessions.find((s) => s.id === req.params.id)
    if (session) session.requires_human = false
    return ok()
  })

  route('PATCH', '/api/ai-sessions/clear-escalations', (req, store) => {
    const instance = bodyOf(req).instance
    for (const session of store.aiSessions) {
      if (session.instance_name === instance) session.requires_human = false
    }
    return ok()
  })

  // ── Notificações ───────────────────────────────────────────────────────
  route('GET', '/api/notifications', (req, store) => {
    const instance = req.query.get('instance')
    if (!instance) return fail('instance required')
    const notifications = store.notifications
      .filter((n) => n.instance_name === instance)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const unreadCount = notifications.filter((n) => !n.read_at).length
    return req.query.get('countOnly') === '1' ? ok({ unreadCount }) : ok({ notifications, unreadCount })
  })

  route('PATCH', '/api/notifications', (req, store) => {
    const { instance, id } = bodyOf(req)
    for (const notification of store.notifications) {
      if (notification.instance_name === instance && (!id || notification.id === id) && !notification.read_at) {
        notification.read_at = nowIso()
      }
    }
    return ok()
  })

  route('DELETE', '/api/notifications', (req, store) => {
    const instance = req.query.get('instance')
    const id = req.query.get('id')
    store.notifications = store.notifications.filter((n) => n.instance_name !== instance || (id !== null && n.id !== id))
    return ok()
  })

  // ── Variáveis de mensagem ──────────────────────────────────────────────
  route('GET', '/api/message-variables', (req, store) =>
    ok({ variables: store.messageVariables.filter((v) => v.instance_name === req.query.get('instance')) }))

  route('POST', '/api/message-variables', (req, store) => {
    const body = bodyOf(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const instanceName = typeof body.instance_name === 'string' ? body.instance_name : ''
    if (!key || !instanceName) return fail('Campos obrigatórios ausentes')
    const timestamp = nowIso()
    const variable: MessageVariable = {
      id: nextId(store, 'var'),
      instance_name: instanceName,
      key,
      label: typeof body.label === 'string' ? body.label : key,
      value: typeof body.value === 'string' ? body.value : '',
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.messageVariables.push(variable)
    return { status: 201, json: { ok: true, variable } }
  })

  route('PUT', '/api/message-variables/:id', (req, store) => patchVariable(req.params.id, bodyOf(req), store))
  route('PATCH', '/api/message-variables/:id', (req, store) => patchVariable(req.params.id, bodyOf(req), store))
  route('DELETE', '/api/message-variables/:id', (req, store) => {
    store.messageVariables = store.messageVariables.filter((v) => v.id !== req.params.id)
    return ok()
  })
}

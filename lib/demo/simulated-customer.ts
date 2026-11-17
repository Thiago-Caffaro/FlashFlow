import type { Message } from '@/types'
import { nowIso } from './clock'
import { DEMO_INSTANCE_PT } from './seed/accounts'
import { nextId, type DemoStore } from './store'

// Respostas pré-escritas do "cliente". A demo não fala com ninguém: isto só
// dá vida ao chat para quem o experimenta.
const REPLIES_ES = [
  'Perfecto, muchas gracias 😊',
  'Vale, entendido.',
  '¿Y el pago es al recibirlo, verdad?',
  'Genial, quedo a la espera entonces.',
  'De acuerdo. ¿Me avisáis cuando salga el pedido?',
  'Gracias por la rapidez 👍',
]

const REPLIES_PT = [
  'Perfeito, muito obrigada 😊',
  'Está bem, entendido.',
  'E o pagamento é só na entrega, certo?',
  'Ótimo, fico a aguardar então.',
  'Combinado. Avisam-me quando sair a encomenda?',
  'Obrigado pela rapidez 👍',
]

const MIN_DELAY_MS = 2000
const EXTRA_DELAY_MS = 2000

/** Agenda uma resposta do cliente simulado na conversa indicada. */
export function scheduleCustomerReply(store: DemoStore, conversationId: string, delayMs?: number): void {
  const delay = delayMs ?? MIN_DELAY_MS + Math.floor(Math.random() * EXTRA_DELAY_MS)
  setTimeout(() => {
    const conversation = store.conversations.find((c) => c.id === conversationId)
    if (!conversation) return
    const pool = conversation.instance_name === DEMO_INSTANCE_PT ? REPLIES_PT : REPLIES_ES
    const content = pool[store.seq % pool.length]
    const createdAt = nowIso()
    const reply: Message = {
      id: nextId(store, 'msg'),
      conversation_id: conversationId,
      wa_message_id: null,
      content,
      type: 'text',
      direction: 'inbound',
      status: 'received',
      sender_type: null,
      created_at: createdAt,
    }
    // O cliente "leu" o que o operador enviou antes de responder.
    for (const message of store.messages) {
      if (message.conversation_id === conversationId && message.direction === 'outbound') message.status = 'read'
    }
    store.messages.push(reply)
    conversation.last_message = content
    conversation.last_message_at = createdAt
    conversation.updated_at = createdAt
  }, delay)
}

import { renderToStaticMarkup } from 'react-dom/server'
import MessageBubble from '@/components/chat/message-bubble'
import type { Message } from '@/types'

function outbound(status: string): Message {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    wa_message_id: null,
    content: 'olá',
    type: 'text',
    direction: 'outbound',
    status,
    sender_type: 'human',
    created_at: '2026-07-30T12:00:00.000Z',
  }
}

describe('MessageBubble — ícone de estado', () => {
  it('mostra um alerta vermelho de "Falha no envio" quando o envio falhou', () => {
    const html = renderToStaticMarkup(<MessageBubble message={outbound('failed')} />)

    expect(html).toContain('aria-label="Falha no envio"')
    expect(html).toContain('text-red-500')
    expect(html).not.toContain('lucide-check-check')
  })

  it('mantém o duplo visto para mensagens enviadas', () => {
    const html = renderToStaticMarkup(<MessageBubble message={outbound('sent')} />)

    expect(html).toContain('lucide-check-check')
    expect(html).not.toContain('Falha no envio')
  })
})

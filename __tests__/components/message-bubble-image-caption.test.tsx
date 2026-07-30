import { renderToStaticMarkup } from 'react-dom/server'
import MessageBubble from '@/components/chat/message-bubble'
import type { Message } from '@/types'

describe('MessageBubble image captions', () => {
  it('renders a stored image URL and caption in the same bubble', () => {
    const message: Message = {
      id: 'message-1',
      conversation_id: 'conversation-1',
      wa_message_id: null,
      content: 'https://example.com/image.jpg\nLegenda da imagem',
      type: 'image',
      direction: 'outbound',
      status: 'sent',
      sender_type: 'flow',
      created_at: '2026-07-30T12:00:00.000Z',
    }

    const html = renderToStaticMarkup(<MessageBubble message={message} />)

    expect(html).toContain('src="https://example.com/image.jpg"')
    expect(html).toContain('Legenda da imagem')
  })
})

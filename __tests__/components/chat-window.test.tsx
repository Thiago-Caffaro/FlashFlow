/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import ChatWindow from '@/components/chat/chat-window'
import type { Conversation } from '@/types'

function conversation(id: string): Conversation {
  return {
    id,
    wa_id: `${id}@s.whatsapp.net`,
    instance_name: 'wa-1',
    contact_name: `Cliente ${id}`,
    contact_phone: '351900000000',
    profile_pic_url: null,
    last_message: null,
    last_message_at: null,
    unread_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

// Renderiza e deixa o fetch inicial das mensagens resolver dentro de act()
async function renderAsync(ui: ReactElement): Promise<RenderResult> {
  let result!: RenderResult
  await act(async () => {
    result = render(ui)
  })
  return result
}

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, messages: [] }) })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(cleanup)

describe('ChatWindow — rascunho por conversa', () => {
  it('não leva o texto digitado para a conversa seguinte', async () => {
    const { rerender } = await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Digite uma mensagem'), { target: { value: 'mensagem para o cliente A' } })

    await act(async () => rerender(<ChatWindow conversation={conversation('b')} onMessageSent={jest.fn()} />))

    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('')
  })

  it('mantém o texto quando a mesma conversa é atualizada pelo polling', async () => {
    const { rerender } = await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Digite uma mensagem'), { target: { value: 'ainda a escrever' } })

    await act(async () => rerender(<ChatWindow conversation={{ ...conversation('a'), contact_name: 'Nome atualizado' }} onMessageSent={jest.fn()} />))

    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('ainda a escrever')
  })
})

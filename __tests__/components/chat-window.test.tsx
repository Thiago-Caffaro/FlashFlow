/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react'
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

describe('ChatWindow — falha de envio', () => {
  function mockSend(response: () => Promise<unknown>) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/messages' && init?.method === 'POST'
        ? response()
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, messages: [] }) })
    )
  }

  function typeAndSend(text: string) {
    const input = screen.getByPlaceholderText('Digite uma mensagem')
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('mostra o erro do servidor, remove a mensagem otimista e devolve o texto ao campo', async () => {
    mockSend(async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: 'WhatsApp desconectado' }) }))
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)

    typeAndSend('olá')

    expect((await screen.findByRole('alert')).textContent).toContain('WhatsApp desconectado')
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('olá')
    expect(screen.queryByText('olá', { ignore: 'textarea' })).toBeNull() // a bolha otimista saiu
  })

  it('em timeout (504) avisa sem repor o texto nem remover a mensagem otimista', async () => {
    mockSend(async () => ({
      ok: false,
      status: 504,
      json: async () => ({ ok: false, error: 'Tempo esgotado ao enviar — resultado desconhecido, verifique antes de reenviar.' }),
    }))
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)

    typeAndSend('olá')

    expect((await screen.findByRole('alert')).textContent).toContain(
      'A mensagem pode ter sido enviada — aguarde a confirmação antes de reenviar.'
    )
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('')
    expect(screen.getByText('olá', { ignore: 'textarea' })).toBeTruthy() // a bolha otimista continua
  })

  it('trata erro de rede da mesma forma', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockSend(async () => { throw new TypeError('Failed to fetch') })
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)

    typeAndSend('olá')

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível enviar')
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('olá')
    consoleError.mockRestore()
  })

  it('usa uma mensagem genérica quando a resposta de erro não é JSON', async () => {
    mockSend(async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('Unexpected token') } }))
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)

    typeAndSend('olá')

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível enviar (HTTP 500)')
  })

  it('não mostra aviso nem repõe texto quando o envio dá certo', async () => {
    const onMessageSent = jest.fn()
    mockSend(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={onMessageSent} />)

    typeAndSend('olá')

    await waitFor(() => expect(onMessageSent).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('')
  })

  it('não repõe por cima do que o operador já começou a escrever', async () => {
    let fail: () => void = () => {}
    mockSend(() => new Promise((resolve) => {
      fail = () => resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: 'falhou' }) })
    }))
    await renderAsync(<ChatWindow conversation={conversation('a')} onMessageSent={jest.fn()} />)

    typeAndSend('primeira')
    fireEvent.change(screen.getByPlaceholderText('Digite uma mensagem'), { target: { value: 'segunda' } })
    fail()

    await screen.findByRole('alert')
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('segunda')
  })

  it('uma falha que chega depois de trocar de conversa não aparece na conversa nova', async () => {
    let fail: (() => void) | null = null
    mockSend(() => new Promise((resolve) => {
      fail = () => resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: 'falhou' }) })
    }))
    const view = (id: string) => <ChatWindow key={id} conversation={conversation(id)} onMessageSent={jest.fn()} />
    const { rerender } = await renderAsync(view('a'))

    typeAndSend('para o cliente A')
    // o envio da conversa A ainda está pendente quando se troca para B
    expect(fail).not.toBeNull()
    await act(async () => rerender(view('b')))
    await act(async () => {
      fail?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('Digite uma mensagem').value).toBe('')
  })
})

/**
 * Retomada de fluxo por toque em botão (webhook WhatsApp Cloud API): o id que
 * nós definimos no botão (payload de quick reply de template, ou
 * interactive.button_reply.id) tem que ser o dado usado para achar a opção do
 * fluxo — o texto exibido pode divergir do label (template escrito em outro
 * idioma na Meta, título interativo truncado em 20 caracteres).
 */
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const TEST_APP_SECRET = 'app-secret-de-teste'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const mockExecuteFlow = jest.fn()
const mockCheckActiveFlowRun = jest.fn()
jest.mock('@/lib/flow-engine', () => ({
  executeFlow: (...args: unknown[]) => mockExecuteFlow(...args),
  checkActiveFlowRun: (...args: unknown[]) => mockCheckActiveFlowRun(...args),
  checkActiveSandboxFlowRunForRealInstance: jest.fn().mockResolvedValue(null),
  checkActiveSession: jest.fn().mockResolvedValue(null),
  handleActiveSession: jest.fn(),
}))
jest.mock('@/lib/message-triggers', () => ({ executeTriggers: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/webhook/whatsapp-cloud/route')

const messagesInsert = jest.fn()

function mockSupabase() {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'whatsapp_cloud_credentials') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { instance_name: 'wa-cloud-1', phone_number_id: '123456' },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
        insert: messagesInsert.mockResolvedValue({ error: null }),
      }
    }
    if (table === 'conversations') {
      return {
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'conv-1', unread_count: 0 }, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    return undefined
  })
}

function postMessage(message: Record<string, unknown>) {
  const rawBody = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '123456' },
          contacts: [{ profile: { name: 'Cliente' }, wa_id: '5511988887777' }],
          messages: [{ from: '5511988887777', id: 'wamid.BTN', timestamp: '1700000000', ...message }],
        },
      }],
    }],
  })
  const signature = `sha256=${createHmac('sha256', TEST_APP_SECRET).update(rawBody, 'utf8').digest('hex')}`
  return POST(new NextRequest('http://localhost/api/webhook/whatsapp-cloud', {
    method: 'POST',
    body: rawBody,
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
  }))
}

// A cascata do fluxo roda fire-and-forget depois da resposta HTTP.
async function waitForExecuteFlow() {
  for (let i = 0; i < 50 && mockExecuteFlow.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('webhook WhatsApp Cloud — retomada de fluxo por botão', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WHATSAPP_CLOUD_APP_SECRET = TEST_APP_SECRET
    mockSupabase()
    mockCheckActiveFlowRun.mockResolvedValue({
      id: 'run-1',
      flow_id: 'flow-1',
      node_id: 'next',
      conversation_id: 'conv-1',
      variables: { orderId: null, replyButtons: [{ id: 'btn-yes', label: 'CONFIRMAR PEDIDO' }, { id: 'btn-no', label: 'MODIFICAR DADOS' }] },
    })
  })

  it('resolves a template quick-reply tap by payload even when the button text is in another language', async () => {
    await postMessage({ type: 'button', button: { text: 'Sí, confirmo', payload: 'btn-yes' } })
    await waitForExecuteFlow()

    expect(mockExecuteFlow).toHaveBeenCalledWith(
      'flow-1',
      expect.objectContaining({ incomingMessage: 'CONFIRMAR PEDIDO', remoteJid: '5511988887777' }),
      'next'
    )
    // O que aparece no chat para o operador continua sendo o texto que o
    // cliente viu no botão, não o id interno.
    expect(messagesInsert).toHaveBeenCalledWith(expect.objectContaining({ content: 'Sí, confirmo', direction: 'inbound' }))
  })

  it('resolves an interactive reply by id when the visible title was truncated', async () => {
    await postMessage({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'btn-no', title: 'MODIFICAR DAD…' } },
    })
    await waitForExecuteFlow()

    expect(mockExecuteFlow).toHaveBeenCalledWith(
      'flow-1',
      expect.objectContaining({ incomingMessage: 'MODIFICAR DADOS' }),
      'next'
    )
  })

  it('still normalizes typed text by label when there is no payload', async () => {
    await postMessage({ type: 'text', text: { body: 'confirmar pedido' } })
    await waitForExecuteFlow()

    expect(mockExecuteFlow).toHaveBeenCalledWith(
      'flow-1',
      expect.objectContaining({ incomingMessage: 'CONFIRMAR PEDIDO' }),
      'next'
    )
  })

  it('passes free text through unchanged when it matches no button (customer answered in their own words)', async () => {
    await postMessage({ type: 'text', text: { body: 'quero falar com um atendente' } })
    await waitForExecuteFlow()

    expect(mockExecuteFlow).toHaveBeenCalledWith(
      'flow-1',
      expect.objectContaining({ incomingMessage: 'quero falar com um atendente' }),
      'next'
    )
  })
})

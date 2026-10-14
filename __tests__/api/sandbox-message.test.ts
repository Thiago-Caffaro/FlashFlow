/**
 * app/api/fulfillment/sandbox/message — retomada de fluxo pausado e botões
 * de resposta, iguais ao webhook real.
 */
import { NextRequest } from 'next/server'

const mockExecuteFlow = jest.fn()
const mockCheckActiveFlowRun = jest.fn()
const mockCheckActiveSession = jest.fn()
const mockHandleActiveSession = jest.fn()

jest.mock('@/lib/server-auth', () => ({ isAdminRequest: () => true }))
jest.mock('@/lib/flow-engine', () => ({
  executeFlow: mockExecuteFlow,
  checkActiveFlowRun: mockCheckActiveFlowRun,
  checkActiveSession: mockCheckActiveSession,
  handleActiveSession: mockHandleActiveSession,
}))

const conversation = {
  id: 'conv-1',
  wa_id: 'sandbox@s.whatsapp.net',
  instance_name: '__sandbox__',
  sandbox_real_send_enabled: false,
  sandbox_source_instance: null,
}

// Toda consulta ao Supabase resolve para a conversa de teste / lista vazia.
function chain(result: unknown) {
  const target: Record<string, unknown> = {}
  const proxy: Record<string, unknown> = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (value: unknown) => unknown) => resolve(result)
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: conversation, error: null })
      return () => proxy
    },
  })
  return proxy
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => chain(table === 'messages' ? { data: [], error: null } : { data: null, error: null }) },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const route = require('@/app/api/fulfillment/sandbox/message/route')

const buttons = [
  { id: 'complete', label: 'COMPLETAR PEDIDO' },
  { id: 'contact', label: 'CONTÁCNOS' },
]

const pausedRun = {
  id: 'run-1',
  flow_id: 'flow-1',
  node_id: 'switch',
  status: 'waiting_confirmation',
  variables: { checkoutId: 'checkout-1', orderId: null, replyButtons: buttons },
}

function post(text: string) {
  return new NextRequest('http://localhost/api/fulfillment/sandbox/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, conversationId: 'conv-1' }),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('sandbox message route', () => {
  it('resumes a paused flow with its run id, cart id and the button typed as a number', async () => {
    mockCheckActiveFlowRun.mockResolvedValue(pausedRun)

    const res = await route.POST(post('2'))

    expect(res.status).toBe(200)
    expect(mockExecuteFlow).toHaveBeenCalledWith('flow-1', expect.objectContaining({
      incomingMessage: 'CONTÁCNOS',
      checkoutId: 'checkout-1',
      flowRunId: 'run-1',
      isSandbox: true,
    }), 'switch')
    expect(mockHandleActiveSession).not.toHaveBeenCalled()
  })

  it('hands the message to the AI session when no flow is paused', async () => {
    mockCheckActiveFlowRun.mockResolvedValue(null)
    mockCheckActiveSession.mockResolvedValue({ id: 'session-1' })

    await route.POST(post('qual é a sua memória?'))

    expect(mockHandleActiveSession).toHaveBeenCalledWith({ id: 'session-1' }, expect.objectContaining({ incomingMessage: 'qual é a sua memória?' }))
    expect(mockExecuteFlow).not.toHaveBeenCalled()
  })

  it('returns the pending reply buttons with the chat history', async () => {
    mockCheckActiveFlowRun.mockResolvedValue(pausedRun)

    const res = await route.GET(new NextRequest('http://localhost/api/fulfillment/sandbox/message?conversationId=conv-1'))
    const json = await res.json()

    expect(json.replyButtons).toEqual(buttons)
  })
})

/**
 * Testes para startTypingIndicator (lib/flow-engine.ts) — o "digitando…" que
 * aparece ao cliente enquanto a IA gera a resposta. O que importa aqui: respeita
 * a barreira de sandbox, repassa o id da mensagem recebida e nunca lança.
 */
export {}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}))
jest.mock('@/lib/ai-crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))

const mockDispatchSendTyping = jest.fn()
const mockDispatchClearTyping = jest.fn()
jest.mock('@/lib/whatsapp-dispatch', () => ({
  dispatchSendTypingIndicator: (...args: unknown[]) => mockDispatchSendTyping(...args),
  dispatchClearTypingIndicator: (...args: unknown[]) => mockDispatchClearTyping(...args),
  dispatchSendText: jest.fn(),
  dispatchSendImage: jest.fn(),
  dispatchSendButtons: jest.fn(),
  dispatchSendTemplate: jest.fn(),
  supportsNativeButtons: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/whatsapp-account-provider', () => ({ getAccountProvider: jest.fn() }))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startTypingIndicator } = require('@/lib/flow-engine')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SANDBOX_INSTANCE_NAME } = require('@/lib/sandbox')

const baseCtx = {
  instanceName: 'wa-1',
  remoteJid: '5511999999999@s.whatsapp.net',
  conversationId: 'conv-1',
  incomingMessage: 'oi',
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('startTypingIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDispatchSendTyping.mockResolvedValue(undefined)
    mockDispatchClearTyping.mockResolvedValue(undefined)
  })

  it('dispatches the indicator for the real instance, passing the inbound message id', async () => {
    startTypingIndicator({ ...baseCtx, inboundWaMessageId: 'wamid.IN' })
    await flushPromises()

    expect(mockDispatchSendTyping).toHaveBeenCalledWith('wa-1', '5511999999999@s.whatsapp.net', { inboundMessageId: 'wamid.IN' })
  })

  it('does not wait for the dispatch (the Evolution call stays open for the whole indicator)', () => {
    mockDispatchSendTyping.mockReturnValue(new Promise(() => {}))

    expect(() => startTypingIndicator(baseCtx)).not.toThrow()
  })

  it('swallows a dispatch failure instead of breaking the AI reply', async () => {
    mockDispatchSendTyping.mockRejectedValue(new Error('evolution down'))

    expect(() => startTypingIndicator(baseCtx)).not.toThrow()
    await flushPromises()
  })

  it('does nothing for a sandbox conversation without real send enabled', async () => {
    const typing = startTypingIndicator({ ...baseCtx, instanceName: SANDBOX_INSTANCE_NAME, isSandbox: true })
    await typing.stop()
    await flushPromises()

    expect(mockDispatchSendTyping).not.toHaveBeenCalled()
    expect(mockDispatchClearTyping).not.toHaveBeenCalled()
  })

  it('targets the real instance for a sandbox conversation with real send enabled', async () => {
    startTypingIndicator({
      ...baseCtx,
      instanceName: SANDBOX_INSTANCE_NAME,
      isSandbox: true,
      realSendInstanceName: 'wa-real',
    })
    await flushPromises()

    expect(mockDispatchSendTyping).toHaveBeenCalledWith('wa-real', '5511999999999@s.whatsapp.net', { inboundMessageId: undefined })
  })

  it('stop() clears the indicator and swallows a failure', async () => {
    const typing = startTypingIndicator(baseCtx)
    await typing.stop()
    expect(mockDispatchClearTyping).toHaveBeenCalledWith('wa-1', '5511999999999@s.whatsapp.net')

    mockDispatchClearTyping.mockRejectedValue(new Error('evolution down'))
    await expect(typing.stop()).resolves.toBeUndefined()
  })
})

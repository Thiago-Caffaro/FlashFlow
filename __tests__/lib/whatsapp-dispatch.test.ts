/**
 * Testes para lib/whatsapp-dispatch.ts — garante que o dispatcher resolve o
 * provedor da conta e delega para o adapter certo, sem alterar os argumentos
 * repassados (indireção pura, não muda payload/comportamento do envio em si).
 */
export {}

const mockGetAccountProvider = jest.fn()
jest.mock('@/lib/whatsapp-account-provider', () => ({
  getAccountProvider: (...args: unknown[]) => mockGetAccountProvider(...args),
}))

const mockEvolutionSendText = jest.fn()
const mockEvolutionSendImage = jest.fn()
const mockEvolutionSendButtons = jest.fn()
const mockEvolutionSendTemplate = jest.fn()
const mockEvolutionSendTyping = jest.fn()
const mockEvolutionClearTyping = jest.fn()
jest.mock('@/lib/whatsapp-evolution-adapter', () => ({
  evolutionAdapter: {
    sendTypingIndicator: (...args: unknown[]) => mockEvolutionSendTyping(...args),
    clearTypingIndicator: (...args: unknown[]) => mockEvolutionClearTyping(...args),
    sendText: (...args: unknown[]) => mockEvolutionSendText(...args),
    sendImage: (...args: unknown[]) => mockEvolutionSendImage(...args),
    sendButtons: (...args: unknown[]) => mockEvolutionSendButtons(...args),
    sendTemplate: (...args: unknown[]) => mockEvolutionSendTemplate(...args),
  },
}))

const mockCloudSendText = jest.fn()
const mockCloudSendImage = jest.fn()
const mockCloudSendButtons = jest.fn()
const mockCloudSendTemplate = jest.fn()
const mockCloudSendTyping = jest.fn()
const mockCloudClearTyping = jest.fn()
jest.mock('@/lib/whatsapp-cloud-adapter', () => ({
  cloudApiAdapter: {
    sendTypingIndicator: (...args: unknown[]) => mockCloudSendTyping(...args),
    clearTypingIndicator: (...args: unknown[]) => mockCloudClearTyping(...args),
    sendText: (...args: unknown[]) => mockCloudSendText(...args),
    sendImage: (...args: unknown[]) => mockCloudSendImage(...args),
    sendButtons: (...args: unknown[]) => mockCloudSendButtons(...args),
    sendTemplate: (...args: unknown[]) => mockCloudSendTemplate(...args),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  dispatchSendText,
  dispatchSendImage,
  dispatchSendButtons,
  dispatchSendTemplate,
  dispatchSendTypingIndicator,
  dispatchClearTypingIndicator,
} = require('@/lib/whatsapp-dispatch')

describe('whatsapp-dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('dispatches sendText to the evolution adapter for an evolution account, preserving all args', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendText.mockResolvedValue({ waMessageId: 'msg-1', raw: { key: { id: 'msg-1' } } })

    const result = await dispatchSendText('wa-1', '5511999999999@s.whatsapp.net', 'oi', 5000)

    expect(mockGetAccountProvider).toHaveBeenCalledWith('wa-1')
    expect(mockEvolutionSendText).toHaveBeenCalledWith('wa-1', '5511999999999@s.whatsapp.net', 'oi', 5000)
    expect(result).toEqual({ waMessageId: 'msg-1', raw: { key: { id: 'msg-1' } } })
  })

  it('dispatches sendImage to the evolution adapter, preserving all args', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendImage.mockResolvedValue({ waMessageId: 'img-1', raw: {} })

    await dispatchSendImage('wa-1', '5511999999999@s.whatsapp.net', 'https://example.com/img.jpg', 'legenda')

    expect(mockEvolutionSendImage).toHaveBeenCalledWith(
      'wa-1', '5511999999999@s.whatsapp.net', 'https://example.com/img.jpg', 'legenda'
    )
  })

  it('dispatches sendButtons to the evolution adapter, preserving all args', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendButtons.mockResolvedValue({ waMessageId: 'btn-1', raw: {} })
    const content = { title: 'Confirme', message: 'Pedido correto?', footer: '', replyButtons: [{ id: 'c', label: 'CONFIRMAR' }] }

    await dispatchSendButtons('wa-1', '5511999999999@s.whatsapp.net', content, { thumbnailUrl: 'https://example.com/thumb.jpg' })

    expect(mockEvolutionSendButtons).toHaveBeenCalledWith(
      'wa-1', '5511999999999@s.whatsapp.net', content, { thumbnailUrl: 'https://example.com/thumb.jpg' }
    )
  })

  it('propagates a failed send as a rejection, without swallowing the error', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendText.mockRejectedValue(new Error('Falha ao enviar mensagem via WhatsApp (503): unavailable'))

    await expect(dispatchSendText('wa-1', 'jid', 'oi')).rejects.toThrow('503')
  })

  it('dispatches sendText to the cloud adapter for a cloud_api account, preserving all args', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockCloudSendText.mockResolvedValue({ waMessageId: 'wamid.1', raw: {} })

    const result = await dispatchSendText('wa-cloud', '5511999999999', 'oi', 5000)

    expect(mockCloudSendText).toHaveBeenCalledWith('wa-cloud', '5511999999999', 'oi', 5000)
    expect(mockEvolutionSendText).not.toHaveBeenCalled()
    expect(result).toEqual({ waMessageId: 'wamid.1', raw: {} })
  })

  it('does not call the evolution adapter for a cloud_api account, and vice versa', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockCloudSendImage.mockRejectedValue(new Error('Envio de imagem ainda não suportado'))

    await expect(dispatchSendImage('wa-cloud', 'jid', 'https://example.com/x.jpg')).rejects.toThrow('ainda não suportado')
    expect(mockEvolutionSendImage).not.toHaveBeenCalled()
  })

  it('dispatches sendTemplate to the cloud adapter, preserving all args', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockCloudSendTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: {} })

    const result = await dispatchSendTemplate('wa-cloud', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'])

    expect(mockCloudSendTemplate).toHaveBeenCalledWith('wa-cloud', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'], undefined)
    expect(result).toEqual({ waMessageId: 'wamid.tpl', raw: {} })
  })

  it('passes quick reply options through to the cloud adapter', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockCloudSendTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: {} })
    const options = { quickReplyPayloads: [{ index: 1, payload: 'btn-2' }] }

    await dispatchSendTemplate('wa-cloud', '5511999999999', 'order_confirmation', 'pt_BR', [], options)

    expect(mockCloudSendTemplate).toHaveBeenCalledWith('wa-cloud', '5511999999999', 'order_confirmation', 'pt_BR', [], options)
  })

  it('dispatches the typing indicator to the evolution adapter for an evolution account', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendTyping.mockResolvedValue(undefined)

    await dispatchSendTypingIndicator('wa-1', '5511999999999@s.whatsapp.net', { inboundMessageId: 'ignored' })

    expect(mockEvolutionSendTyping).toHaveBeenCalledWith('wa-1', '5511999999999@s.whatsapp.net', { inboundMessageId: 'ignored' })
    expect(mockCloudSendTyping).not.toHaveBeenCalled()
  })

  it('dispatches the typing indicator to the cloud adapter, passing the inbound message id', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockCloudSendTyping.mockResolvedValue(undefined)

    await dispatchSendTypingIndicator('wa-cloud', '5511999999999', { inboundMessageId: 'wamid.IN' })

    expect(mockCloudSendTyping).toHaveBeenCalledWith('wa-cloud', '5511999999999', { inboundMessageId: 'wamid.IN' })
    expect(mockEvolutionSendTyping).not.toHaveBeenCalled()
  })

  it('dispatches clearing the typing indicator to the right adapter', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    await dispatchClearTypingIndicator('wa-1', 'jid')
    expect(mockEvolutionClearTyping).toHaveBeenCalledWith('wa-1', 'jid')

    mockGetAccountProvider.mockResolvedValue('cloud_api')
    await dispatchClearTypingIndicator('wa-cloud', 'jid')
    expect(mockCloudClearTyping).toHaveBeenCalledWith('wa-cloud', 'jid')
  })

  it('dispatches sendTemplate to the evolution adapter, which rejects as unsupported', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockEvolutionSendTemplate.mockRejectedValue(new Error('Templates não são suportados para contas Evolution'))

    await expect(dispatchSendTemplate('wa-1', 'jid', 'tpl', 'pt_BR', []))
      .rejects.toThrow('não são suportados')
    expect(mockCloudSendTemplate).not.toHaveBeenCalled()
  })
})

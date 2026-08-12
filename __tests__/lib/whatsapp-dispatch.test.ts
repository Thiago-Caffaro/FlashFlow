/**
 * Testes para lib/whatsapp-dispatch.ts — garante que o dispatcher resolve o
 * provedor da conta e delega para o adapter certo, sem alterar os argumentos
 * repassados (a Fase 0 só introduz indireção, não muda payload/comportamento
 * do envio via Evolution).
 */

const mockGetAccountProvider = jest.fn()
jest.mock('@/lib/whatsapp-account-provider', () => ({
  getAccountProvider: (...args: unknown[]) => mockGetAccountProvider(...args),
}))

const mockEvolutionSendText = jest.fn()
const mockEvolutionSendImage = jest.fn()
const mockEvolutionSendButtons = jest.fn()
jest.mock('@/lib/whatsapp-evolution-adapter', () => ({
  evolutionAdapter: {
    sendText: (...args: unknown[]) => mockEvolutionSendText(...args),
    sendImage: (...args: unknown[]) => mockEvolutionSendImage(...args),
    sendButtons: (...args: unknown[]) => mockEvolutionSendButtons(...args),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dispatchSendText, dispatchSendImage, dispatchSendButtons } = require('@/lib/whatsapp-dispatch')

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

  it('throws for cloud_api accounts, not yet supported in Fase 0', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')

    await expect(dispatchSendText('wa-cloud', 'jid', 'oi')).rejects.toThrow('cloud_api')
    expect(mockEvolutionSendText).not.toHaveBeenCalled()
  })
})

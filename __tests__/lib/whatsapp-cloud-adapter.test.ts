/**
 * Testes para lib/whatsapp-cloud-adapter.ts — a implementação real do
 * WhatsAppProviderAdapter para contas cloud_api (Fase 1: texto; Fase 2:
 * imagem; Fase 3: botões; Fase 4: templates).
 */
export {}

const mockLoadCloudCredentials = jest.fn()
const mockDecodeCloudAccessToken = jest.fn()
const mockRecordCloudSendError = jest.fn()
const mockClearCloudSendError = jest.fn()
jest.mock('@/lib/whatsapp-cloud-credentials', () => ({
  loadCloudCredentials: (...args: unknown[]) => mockLoadCloudCredentials(...args),
  decodeCloudAccessToken: (...args: unknown[]) => mockDecodeCloudAccessToken(...args),
  recordCloudSendError: (...args: unknown[]) => mockRecordCloudSendError(...args),
  clearCloudSendError: (...args: unknown[]) => mockClearCloudSendError(...args),
}))

const mockSendCloudText = jest.fn()
const mockSendCloudImage = jest.fn()
const mockSendCloudButtons = jest.fn()
const mockSendCloudTemplate = jest.fn()
const mockSendCloudTypingIndicator = jest.fn()
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  sendCloudTypingIndicator: (...args: unknown[]) => mockSendCloudTypingIndicator(...args),
  sendCloudText: (...args: unknown[]) => mockSendCloudText(...args),
  sendCloudImage: (...args: unknown[]) => mockSendCloudImage(...args),
  sendCloudButtons: (...args: unknown[]) => mockSendCloudButtons(...args),
  sendCloudTemplate: (...args: unknown[]) => mockSendCloudTemplate(...args),
}))

import { WhatsAppCloudApiError } from '@/lib/whatsapp-cloud-errors'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cloudApiAdapter } = require('@/lib/whatsapp-cloud-adapter')

describe('cloudApiAdapter.sendText', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads credentials, decodes the token, and sends via the client with the right args', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1',
      phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudText.mockResolvedValue({ waMessageId: 'wamid.1', raw: { ok: true } })

    const result = await cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi', 5000)

    expect(mockLoadCloudCredentials).toHaveBeenCalledWith('wa-1')
    expect(mockSendCloudText).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', 'oi', 5000)
    expect(result).toEqual({ waMessageId: 'wamid.1', raw: { ok: true } })
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })

  it('throws when the account has no cloud_api credentials configured', async () => {
    mockLoadCloudCredentials.mockResolvedValue(null)

    await expect(cloudApiAdapter.sendText('wa-sem-credenciais', '5511999999999', 'oi'))
      .rejects.toThrow('não tem credenciais')
    expect(mockSendCloudText).not.toHaveBeenCalled()
  })

  it('records the error via recordCloudSendError and re-throws when the send fails', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudText.mockRejectedValue(new WhatsAppCloudApiError('Falha ao enviar mensagem via WhatsApp Cloud API (401): Invalid OAuth access token code=190', 401, 190))

    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi'))
      .rejects.toThrow('Invalid OAuth access token')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      expect.stringContaining('Invalid OAuth access token')
    )
  })
})

describe('cloudApiAdapter.sendTypingIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const credentials = {
    instance_name: 'wa-1', phone_number_id: '123456',
    encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
  }

  it('sends the indicator tied to the inbound message id using the account credentials', async () => {
    mockLoadCloudCredentials.mockResolvedValue(credentials)
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTypingIndicator.mockResolvedValue(undefined)

    await cloudApiAdapter.sendTypingIndicator('wa-1', '5511999999999', { inboundMessageId: 'wamid.IN' })

    expect(mockSendCloudTypingIndicator).toHaveBeenCalledWith('123456', 'plain-token', 'wamid.IN', expect.any(Number))
  })

  it('does nothing when there is no inbound message to attach the indicator to', async () => {
    await cloudApiAdapter.sendTypingIndicator('wa-1', '5511999999999')
    await cloudApiAdapter.sendTypingIndicator('wa-1', '5511999999999', { inboundMessageId: null })

    expect(mockLoadCloudCredentials).not.toHaveBeenCalled()
    expect(mockSendCloudTypingIndicator).not.toHaveBeenCalled()
  })

  it('re-throws a failure without flagging the account as having a send error', async () => {
    mockLoadCloudCredentials.mockResolvedValue(credentials)
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTypingIndicator.mockRejectedValue(new Error('boom'))

    await expect(cloudApiAdapter.sendTypingIndicator('wa-1', '5511999999999', { inboundMessageId: 'wamid.IN' }))
      .rejects.toThrow('boom')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })

  it('clearTypingIndicator is a no-op (the Cloud API cannot cancel it)', async () => {
    await expect(cloudApiAdapter.clearTypingIndicator('wa-1', '5511999999999')).resolves.toBeUndefined()
    expect(mockLoadCloudCredentials).not.toHaveBeenCalled()
  })
})

describe('cloudApiAdapter.sendImage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads credentials, decodes the token, and sends via the client with the right args', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1',
      phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudImage.mockResolvedValue({ waMessageId: 'wamid.2', raw: { ok: true } })

    const result = await cloudApiAdapter.sendImage('wa-1', '5511999999999', 'https://x/img.jpg', 'legenda')

    expect(mockSendCloudImage).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', 'https://x/img.jpg', 'legenda')
    expect(result).toEqual({ waMessageId: 'wamid.2', raw: { ok: true } })
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })

  it('throws when the account has no cloud_api credentials configured', async () => {
    mockLoadCloudCredentials.mockResolvedValue(null)

    await expect(cloudApiAdapter.sendImage('wa-sem-credenciais', '5511999999999', 'https://x/img.jpg'))
      .rejects.toThrow('não tem credenciais')
    expect(mockSendCloudImage).not.toHaveBeenCalled()
  })

  it('não marca a conta em erro 400 de URL de imagem e relança', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudImage.mockRejectedValue(new WhatsAppCloudApiError('Falha ao enviar imagem via WhatsApp Cloud API (400): Invalid image URL', 400, null))

    await expect(cloudApiAdapter.sendImage('wa-1', '5511999999999', 'https://x/img.jpg'))
      .rejects.toThrow('Invalid image URL')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })
})

describe('cloudApiAdapter.sendButtons', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const fullContent = {
    title: 'Confirme',
    message: 'Pedido correto?',
    footer: 'Selecione',
    replyButtons: [{ id: 'confirm', label: 'CONFIRMAR' }, { id: 'change', label: 'MODIFICAR' }],
  }

  it('loads credentials and maps RenderedMessageContent to the client input shape', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockResolvedValue({ waMessageId: 'wamid.3', raw: { ok: true } })

    const result = await cloudApiAdapter.sendButtons('wa-1', '5511999999999', fullContent)

    expect(mockSendCloudButtons).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', {
      headerText: 'Confirme',
      headerImageUrl: undefined,
      bodyText: 'Pedido correto?',
      footerText: 'Selecione',
      buttons: [{ id: 'confirm', title: 'CONFIRMAR' }, { id: 'change', title: 'MODIFICAR' }],
    })
    expect(result).toEqual({ waMessageId: 'wamid.3', raw: { ok: true } })
  })

  it('passes thumbnailUrl through as the image header', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockResolvedValue({ waMessageId: 'wamid.4', raw: {} })

    await cloudApiAdapter.sendButtons('wa-1', '5511999999999', fullContent, { thumbnailUrl: 'https://cdn.example/thumb.jpg' })

    expect(mockSendCloudButtons).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999',
      expect.objectContaining({ headerImageUrl: 'https://cdn.example/thumb.jpg' })
    )
  })

  it('truncates button titles longer than 20 characters instead of failing the whole send', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockResolvedValue({ waMessageId: 'wamid.5', raw: {} })

    await cloudApiAdapter.sendButtons('wa-1', '5511999999999', {
      ...fullContent,
      replyButtons: [{ id: 'a', label: 'Este label tem mais de vinte caracteres' }],
    })

    const call = mockSendCloudButtons.mock.calls[0][3]
    expect(call.buttons[0].title.length).toBeLessThanOrEqual(20)
    expect(call.buttons[0].title.endsWith('…')).toBe(true)
  })

  it('caps buttons at 3, dropping the rest', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockResolvedValue({ waMessageId: 'wamid.6', raw: {} })

    await cloudApiAdapter.sendButtons('wa-1', '5511999999999', {
      ...fullContent,
      replyButtons: [
        { id: '1', label: 'Um' }, { id: '2', label: 'Dois' },
        { id: '3', label: 'Tres' }, { id: '4', label: 'Quatro' },
      ],
    })

    const call = mockSendCloudButtons.mock.calls[0][3]
    expect(call.buttons).toHaveLength(3)
  })

  it('rejects without touching credentials when the message body is empty', async () => {
    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', { ...fullContent, message: '   ' }))
      .rejects.toThrow('Corpo da mensagem vazio')
    expect(mockLoadCloudCredentials).not.toHaveBeenCalled()
  })

  it('rejects without touching credentials when there are no buttons', async () => {
    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', { ...fullContent, replyButtons: [] }))
      .rejects.toThrow('Nenhum botão definido')
    expect(mockLoadCloudCredentials).not.toHaveBeenCalled()
  })

  it('não marca a conta em erro 400 de payload dos botões e relança', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockRejectedValue(new WhatsAppCloudApiError('Falha ao enviar botões via WhatsApp Cloud API (400): Body text cannot be empty', 400, null))

    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', fullContent))
      .rejects.toThrow('Body text cannot be empty')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })
})

describe('cloudApiAdapter.sendTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads credentials, decodes the token, and sends via the client with the right args', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: { ok: true } })

    const result = await cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'])

    expect(mockSendCloudTemplate).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'], undefined, undefined)
    expect(result).toEqual({ waMessageId: 'wamid.tpl', raw: { ok: true } })
  })

  it('forwards quick reply payloads to the client so button taps can be traced back', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: {} })
    const options = { quickReplyPayloads: [{ index: 0, payload: 'btn-yes' }] }

    await cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'order_confirmation', 'pt_BR', [], options)

    expect(mockSendCloudTemplate).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', 'order_confirmation', 'pt_BR', [], undefined, options)
  })

  it('throws when the account has no cloud_api credentials configured', async () => {
    mockLoadCloudCredentials.mockResolvedValue(null)

    await expect(cloudApiAdapter.sendTemplate('wa-sem-credenciais', '5511999999999', 'tpl', 'pt_BR', []))
      .rejects.toThrow('não tem credenciais')
    expect(mockSendCloudTemplate).not.toHaveBeenCalled()
  })

  it('não marca a conta em erro 400 de template inexistente e relança', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTemplate.mockRejectedValue(new WhatsAppCloudApiError('Falha ao enviar template via WhatsApp Cloud API (400): Template name does not exist', 400, null))

    await expect(cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'inexistente', 'pt_BR', []))
      .rejects.toThrow('Template name does not exist')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })
})

describe('cloudApiAdapter — saúde da conta', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
  })

  const credentials = {
    instance_name: 'wa-1', phone_number_id: '123456',
    encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
  }
  const accountError = () => new WhatsAppCloudApiError('Invalid OAuth access token code=190', 401, 190)
  const buttonContent = {
    title: '', message: 'Escolha', footer: '',
    replyButtons: [{ id: 'a', label: 'Sim' }],
  }

  it('erro de destinatário não marca a conta com erro', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: null })
    mockSendCloudText.mockRejectedValue(new WhatsAppCloudApiError('Re-engagement message code=131047', 400, 131047))
    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')).rejects.toThrow('131047')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
  })

  it('timeout de rede não marca a conta com erro nem limpa um erro existente', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: 'Invalid OAuth access token code=190' })
    mockSendCloudText.mockRejectedValue(new Error('The operation was aborted'))
    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')).rejects.toThrow('aborted')
    expect(mockRecordCloudSendError).not.toHaveBeenCalled()
    expect(mockClearCloudSendError).not.toHaveBeenCalled()
  })

  it('token indecifrável marca a conta com erro e relança sem enviar', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: null })
    mockDecodeCloudAccessToken.mockImplementationOnce(() => { throw new Error('Unsupported state or unable to authenticate data') })
    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')).rejects.toThrow('unable to authenticate data')
    expect(mockSendCloudText).not.toHaveBeenCalled()
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      'Não foi possível decifrar o token da conta: Unsupported state or unable to authenticate data'
    )
    expect(mockClearCloudSendError).not.toHaveBeenCalled()
  })

  it('envio de texto com sucesso limpa um last_error anterior', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: 'erro antigo' })
    mockSendCloudText.mockResolvedValue({ waMessageId: 'wamid.1', raw: {} })
    await cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')
    expect(mockClearCloudSendError).toHaveBeenCalledWith('wa-1')
  })

  it('envio com sucesso não escreve no banco quando não há last_error', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: null })
    mockSendCloudText.mockResolvedValue({ waMessageId: 'wamid.1', raw: {} })
    await cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')
    expect(mockClearCloudSendError).not.toHaveBeenCalled()
  })

  it('sendText: erro de conta marca a conta', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: null })
    mockSendCloudText.mockRejectedValue(accountError())
    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi')).rejects.toThrow('190')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith('wa-1', expect.stringContaining('190'))
  })

  it('sendImage: erro de conta marca a conta e sucesso limpa last_error', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: 'erro antigo' })
    mockSendCloudImage.mockRejectedValueOnce(accountError())
    await expect(cloudApiAdapter.sendImage('wa-1', '5511999999999', 'https://x/i.jpg')).rejects.toThrow('190')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith('wa-1', expect.stringContaining('190'))
    mockSendCloudImage.mockResolvedValueOnce({ waMessageId: 'w', raw: {} })
    await cloudApiAdapter.sendImage('wa-1', '5511999999999', 'https://x/i.jpg')
    expect(mockClearCloudSendError).toHaveBeenCalledWith('wa-1')
  })

  it('sendButtons: erro de conta marca a conta e sucesso limpa last_error', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: 'erro antigo' })
    mockSendCloudButtons.mockRejectedValueOnce(accountError())
    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', buttonContent)).rejects.toThrow('190')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith('wa-1', expect.stringContaining('190'))
    mockSendCloudButtons.mockResolvedValueOnce({ waMessageId: 'w', raw: {} })
    await cloudApiAdapter.sendButtons('wa-1', '5511999999999', buttonContent)
    expect(mockClearCloudSendError).toHaveBeenCalledWith('wa-1')
  })

  it('sendTemplate: erro de conta marca a conta e sucesso limpa last_error', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ ...credentials, last_error: 'erro antigo' })
    mockSendCloudTemplate.mockRejectedValueOnce(accountError())
    await expect(cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'tpl', 'pt_BR', [])).rejects.toThrow('190')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith('wa-1', expect.stringContaining('190'))
    mockSendCloudTemplate.mockResolvedValueOnce({ waMessageId: 'w', raw: {} })
    await cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'tpl', 'pt_BR', [])
    expect(mockClearCloudSendError).toHaveBeenCalledWith('wa-1')
  })
})

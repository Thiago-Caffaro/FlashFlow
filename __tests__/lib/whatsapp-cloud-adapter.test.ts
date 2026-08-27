/**
 * Testes para lib/whatsapp-cloud-adapter.ts — a implementação real do
 * WhatsAppProviderAdapter para contas cloud_api (Fase 1: texto; Fase 2:
 * imagem; Fase 3: botões; Fase 4: templates).
 */
export {}

const mockLoadCloudCredentials = jest.fn()
const mockDecodeCloudAccessToken = jest.fn()
const mockRecordCloudSendError = jest.fn()
jest.mock('@/lib/whatsapp-cloud-credentials', () => ({
  loadCloudCredentials: (...args: unknown[]) => mockLoadCloudCredentials(...args),
  decodeCloudAccessToken: (...args: unknown[]) => mockDecodeCloudAccessToken(...args),
  recordCloudSendError: (...args: unknown[]) => mockRecordCloudSendError(...args),
}))

const mockSendCloudText = jest.fn()
const mockSendCloudImage = jest.fn()
const mockSendCloudButtons = jest.fn()
const mockSendCloudTemplate = jest.fn()
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  sendCloudText: (...args: unknown[]) => mockSendCloudText(...args),
  sendCloudImage: (...args: unknown[]) => mockSendCloudImage(...args),
  sendCloudButtons: (...args: unknown[]) => mockSendCloudButtons(...args),
  sendCloudTemplate: (...args: unknown[]) => mockSendCloudTemplate(...args),
}))

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
    mockSendCloudText.mockRejectedValue(new Error('Falha ao enviar mensagem via WhatsApp Cloud API (401): Invalid OAuth access token'))

    await expect(cloudApiAdapter.sendText('wa-1', '5511999999999', 'oi'))
      .rejects.toThrow('Invalid OAuth access token')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      expect.stringContaining('Invalid OAuth access token')
    )
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

  it('records the error via recordCloudSendError and re-throws when the send fails', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudImage.mockRejectedValue(new Error('Falha ao enviar imagem via WhatsApp Cloud API (400): Invalid image URL'))

    await expect(cloudApiAdapter.sendImage('wa-1', '5511999999999', 'https://x/img.jpg'))
      .rejects.toThrow('Invalid image URL')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      expect.stringContaining('Invalid image URL')
    )
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

  it('records the error via recordCloudSendError and re-throws when the send fails', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudButtons.mockRejectedValue(new Error('Falha ao enviar botões via WhatsApp Cloud API (400): Body text cannot be empty'))

    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', fullContent))
      .rejects.toThrow('Body text cannot be empty')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      expect.stringContaining('Body text cannot be empty')
    )
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

    expect(mockSendCloudTemplate).toHaveBeenCalledWith('123456', 'plain-token', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'])
    expect(result).toEqual({ waMessageId: 'wamid.tpl', raw: { ok: true } })
  })

  it('throws when the account has no cloud_api credentials configured', async () => {
    mockLoadCloudCredentials.mockResolvedValue(null)

    await expect(cloudApiAdapter.sendTemplate('wa-sem-credenciais', '5511999999999', 'tpl', 'pt_BR', []))
      .rejects.toThrow('não tem credenciais')
    expect(mockSendCloudTemplate).not.toHaveBeenCalled()
  })

  it('records the error via recordCloudSendError and re-throws when the send fails', async () => {
    mockLoadCloudCredentials.mockResolvedValue({
      instance_name: 'wa-1', phone_number_id: '123456',
      encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
    })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockSendCloudTemplate.mockRejectedValue(new Error('Falha ao enviar template via WhatsApp Cloud API (400): Template name does not exist'))

    await expect(cloudApiAdapter.sendTemplate('wa-1', '5511999999999', 'inexistente', 'pt_BR', []))
      .rejects.toThrow('Template name does not exist')
    expect(mockRecordCloudSendError).toHaveBeenCalledWith(
      'wa-1',
      expect.stringContaining('Template name does not exist')
    )
  })
})

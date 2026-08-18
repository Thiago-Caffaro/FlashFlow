/**
 * Testes para lib/whatsapp-cloud-adapter.ts — a implementação real do
 * WhatsAppProviderAdapter para contas cloud_api (Fase 1: texto; Fase 2: imagem).
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
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  sendCloudText: (...args: unknown[]) => mockSendCloudText(...args),
  sendCloudImage: (...args: unknown[]) => mockSendCloudImage(...args),
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

describe('cloudApiAdapter.sendButtons (fora do escopo da Fase 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sendButtons throws "not supported" without touching credentials or the client', async () => {
    const content = { title: '', message: 'oi', footer: '', replyButtons: [] }
    await expect(cloudApiAdapter.sendButtons('wa-1', '5511999999999', content))
      .rejects.toThrow('ainda não suportado')
    expect(mockLoadCloudCredentials).not.toHaveBeenCalled()
  })
})

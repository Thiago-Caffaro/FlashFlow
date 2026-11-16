import { WhatsAppCloudApiError, isCloudAccountLevelError } from '@/lib/whatsapp-cloud-errors'

describe('isCloudAccountLevelError', () => {
  it.each([
    [401, 190], [401, null], [403, 10], [403, null], [400, 190], [400, 200], [400, 299],
    [400, 368], [400, 131005], [403, 131031], [400, 131042], [400, 131045], [400, 133010],
  ])('HTTP %i code %p é erro da conta', (status, code) => {
    expect(isCloudAccountLevelError(new WhatsAppCloudApiError('x', status, code))).toBe(true)
  })

  it.each([
    [400, 131026], // destinatário não recebe
    [400, 131047], // fora da janela de 24 h
    [400, 131021], // destinatário igual ao remetente
    [400, 132000], // parâmetros do template
    [400, 132001], // template não existe
    [400, 100],    // parâmetro inválido
    [429, 130429], // rate limit
    [429, 131048], // limite por spam
    [500, null], [400, null],
  ])('HTTP %i code %p não é erro da conta', (status, code) => {
    expect(isCloudAccountLevelError(new WhatsAppCloudApiError('x', status, code))).toBe(false)
  })

  it('GraphMethodException (conta sem WABA atribuída) é erro da conta', () => {
    const error = new WhatsAppCloudApiError('Unsupported post request', 400, 100, { type: 'GraphMethodException' })
    expect(isCloudAccountLevelError(error)).toBe(true)
  })

  it('code 100 com subcode 33 (objeto inexistente ou sem permissão) é erro da conta', () => {
    const error = new WhatsAppCloudApiError('Unsupported post request', 400, 100, { subcode: 33 })
    expect(isCloudAccountLevelError(error)).toBe(true)
  })

  it('code 100 sem subcode nem GraphMethodException não é erro da conta', () => {
    const error = new WhatsAppCloudApiError('Invalid parameter', 400, 100, { type: 'OAuthException', subcode: null })
    expect(isCloudAccountLevelError(error)).toBe(false)
  })

  it('erros que não vieram da Graph API não são erro da conta', () => {
    expect(isCloudAccountLevelError(new Error('The operation was aborted'))).toBe(false)
    expect(isCloudAccountLevelError('falhou')).toBe(false)
    expect(isCloudAccountLevelError(null)).toBe(false)
  })
})

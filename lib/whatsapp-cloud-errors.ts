// Sem 'server-only' e sem imports do projeto: módulo puro, testável isolado.

export class WhatsAppCloudApiError extends Error {
  readonly status: number
  readonly code: number | null

  constructor(message: string, status: number, code: number | null) {
    super(message)
    this.name = 'WhatsAppCloudApiError'
    this.status = status
    this.code = code
  }
}

// Códigos da Graph API que indicam problema na conta/credencial (token
// inválido/expirado, permissão, conta restrita ou sem pagamento), e não em
// um destinatário ou mensagem específicos.
const ACCOUNT_LEVEL_CODES = new Set([10, 190, 368, 131005, 131031, 131045, 133010])

export function isCloudAccountLevelError(error: unknown): boolean {
  if (!(error instanceof WhatsAppCloudApiError)) return false
  if (error.status === 401 || error.status === 403) return true
  if (error.code === null) return false
  if (ACCOUNT_LEVEL_CODES.has(error.code)) return true
  return error.code >= 200 && error.code <= 299
}

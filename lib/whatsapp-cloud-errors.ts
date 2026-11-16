// Sem 'server-only' e sem imports do projeto: módulo puro, testável isolado.

export interface WhatsAppCloudApiErrorDetails {
  // `error.type` da Graph API (ex.: 'OAuthException', 'GraphMethodException').
  type?: string | null
  // `error.error_subcode` da Graph API.
  subcode?: number | null
}

export class WhatsAppCloudApiError extends Error {
  readonly status: number
  readonly code: number | null
  readonly type: string | null
  readonly subcode: number | null

  constructor(message: string, status: number, code: number | null, details: WhatsAppCloudApiErrorDetails = {}) {
    super(message)
    this.name = 'WhatsAppCloudApiError'
    this.status = status
    this.code = code
    this.type = details.type ?? null
    this.subcode = details.subcode ?? null
  }
}

// Códigos da Graph API que indicam problema na conta/credencial (token
// inválido/expirado, permissão, conta restrita ou sem pagamento — 131042),
// e não em um destinatário ou mensagem específicos.
const ACCOUNT_LEVEL_CODES = new Set([10, 190, 368, 131005, 131031, 131042, 131045, 133010])

// "Unsupported post request" (GraphMethodException, code 100) é o que a Meta
// devolve quando o usuário do sistema não tem a WABA atribuída — leituras
// continuam funcionando (a verificação passa), mas todo envio falha. O
// subcode 33 (objeto inexistente/sem permissão) indica o mesmo problema.
// Code 100 genérico (parâmetro inválido) continua sendo erro da mensagem.
function isAccountLevelGraphMethodError(error: WhatsAppCloudApiError): boolean {
  if (error.type === 'GraphMethodException') return true
  return error.code === 100 && error.subcode === 33
}

export function isCloudAccountLevelError(error: unknown): boolean {
  if (!(error instanceof WhatsAppCloudApiError)) return false
  if (error.status === 401 || error.status === 403) return true
  if (isAccountLevelGraphMethodError(error)) return true
  if (error.code === null) return false
  if (ACCOUNT_LEVEL_CODES.has(error.code)) return true
  return error.code >= 200 && error.code <= 299
}

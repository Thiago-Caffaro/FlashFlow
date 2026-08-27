import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const WHATSAPP_CLOUD_SIGNATURE_HEADER = 'x-hub-signature-256'

// Handshake de registro do webhook no painel da Meta (WhatsApp → Configuration):
// GET com ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... — só
// confirma se o verify_token bate com o configurado; falha fechado se
// WHATSAPP_CLOUD_VERIFY_TOKEN não estiver configurado no ambiente.
export function verifyCloudWebhookHandshake(mode: string | null, verifyToken: string | null): boolean {
  const expected = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN
  if (!expected || !verifyToken || mode !== 'subscribe') return false
  const provided = Buffer.from(verifyToken, 'utf8')
  const configured = Buffer.from(expected, 'utf8')
  return provided.length === configured.length && timingSafeEqual(provided, configured)
}

// Toda entrega de evento (POST) vem assinada com HMAC-SHA256 do corpo cru
// usando o App Secret — comparação em tempo constante, falha fechado se
// WHATSAPP_CLOUD_APP_SECRET não estiver configurado.
export function verifyCloudWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_CLOUD_APP_SECRET
  if (!secret || !signatureHeader) return false
  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) return false

  const provided = Buffer.from(signatureHeader.slice(prefix.length), 'utf8')
  const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const expected = Buffer.from(expectedHex, 'utf8')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

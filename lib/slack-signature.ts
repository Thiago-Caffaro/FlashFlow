import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Verificação de requisições do Slack
// (https://docs.slack.dev/authentication/verifying-requests-from-slack):
// assinatura = "v0=" + HMAC-SHA256(signing secret, "v0:{timestamp}:{corpo cru}").
// Timestamp com mais de 5 min de diferença é rejeitado (replay).

const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export function verifySlackSignature(input: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  signingSecret: string
  nowSeconds?: number
}): boolean {
  if (!input.signingSecret || !input.timestamp || !input.signature) return false
  const timestamp = Number(input.timestamp)
  if (!Number.isInteger(timestamp)) return false
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false

  const expected = `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest('hex')}`
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const receivedBuffer = Buffer.from(input.signature, 'utf8')
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

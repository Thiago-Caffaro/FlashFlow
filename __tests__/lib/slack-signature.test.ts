import { createHmac } from 'node:crypto'
import { verifySlackSignature } from '@/lib/slack-signature'

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5'
const NOW = 1_760_000_000

function sign(body: string, timestamp: number, secret = SECRET) {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`
}

describe('verifySlackSignature', () => {
  const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D'

  it('accepts a request signed with the signing secret over the raw body', () => {
    expect(verifySlackSignature({
      rawBody: body, timestamp: String(NOW), signature: sign(body, NOW), signingSecret: SECRET, nowSeconds: NOW + 10,
    })).toBe(true)
  })

  it('rejects a tampered body, another secret or a missing header', () => {
    expect(verifySlackSignature({
      rawBody: `${body}x`, timestamp: String(NOW), signature: sign(body, NOW), signingSecret: SECRET, nowSeconds: NOW,
    })).toBe(false)
    expect(verifySlackSignature({
      rawBody: body, timestamp: String(NOW), signature: sign(body, NOW, 'other-secret'), signingSecret: SECRET, nowSeconds: NOW,
    })).toBe(false)
    expect(verifySlackSignature({
      rawBody: body, timestamp: null, signature: sign(body, NOW), signingSecret: SECRET, nowSeconds: NOW,
    })).toBe(false)
  })

  it('rejects requests older than 5 minutes (replay)', () => {
    expect(verifySlackSignature({
      rawBody: body, timestamp: String(NOW), signature: sign(body, NOW), signingSecret: SECRET, nowSeconds: NOW + 301,
    })).toBe(false)
  })
})

/**
 * Testes para lib/whatsapp-cloud-webhook-auth.ts — verificação de assinatura
 * é o ponto mais sensível da Fase 1: rejeitar demais perde mensagem
 * silenciosamente, aceitar demais é um furo de segurança (qualquer um
 * poderia forjar webhooks).
 */

import { createHmac } from 'node:crypto'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyCloudWebhookHandshake, verifyCloudWebhookSignature } = require('@/lib/whatsapp-cloud-webhook-auth')

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('verifyCloudWebhookHandshake', () => {
  it('accepts a matching verify_token with mode=subscribe', () => {
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = 'meu-segredo'
    expect(verifyCloudWebhookHandshake('subscribe', 'meu-segredo')).toBe(true)
  })

  it('rejects a wrong verify_token', () => {
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = 'meu-segredo'
    expect(verifyCloudWebhookHandshake('subscribe', 'token-errado')).toBe(false)
  })

  it('rejects when mode is not "subscribe"', () => {
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = 'meu-segredo'
    expect(verifyCloudWebhookHandshake('unsubscribe', 'meu-segredo')).toBe(false)
  })

  it('fails closed when WHATSAPP_CLOUD_VERIFY_TOKEN is not configured', () => {
    delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN
    expect(verifyCloudWebhookHandshake('subscribe', 'qualquer-coisa')).toBe(false)
  })

  it('rejects a null token', () => {
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = 'meu-segredo'
    expect(verifyCloudWebhookHandshake('subscribe', null)).toBe(false)
  })
})

describe('verifyCloudWebhookSignature', () => {
  const secret = 'app-secret-de-teste'
  const rawBody = JSON.stringify({ entry: [{ id: '123', changes: [] }] })

  function sign(body: string, withSecret = secret): string {
    return `sha256=${createHmac('sha256', withSecret).update(body, 'utf8').digest('hex')}`
  }

  beforeEach(() => {
    process.env.WHATSAPP_CLOUD_APP_SECRET = secret
  })

  it('accepts a correctly signed body (valid vector)', () => {
    expect(verifyCloudWebhookSignature(rawBody, sign(rawBody))).toBe(true)
  })

  it('rejects a body that was tampered with after signing (tampered vector)', () => {
    const validSignature = sign(rawBody)
    const tamperedBody = JSON.stringify({ entry: [{ id: '999', changes: [] }] })
    expect(verifyCloudWebhookSignature(tamperedBody, validSignature)).toBe(false)
  })

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyCloudWebhookSignature(rawBody, sign(rawBody, 'secret-errado'))).toBe(false)
  })

  it('rejects a signature missing the "sha256=" prefix', () => {
    const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    expect(verifyCloudWebhookSignature(rawBody, digest)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyCloudWebhookSignature(rawBody, null)).toBe(false)
  })

  it('fails closed when WHATSAPP_CLOUD_APP_SECRET is not configured', () => {
    delete process.env.WHATSAPP_CLOUD_APP_SECRET
    expect(verifyCloudWebhookSignature(rawBody, sign(rawBody))).toBe(false)
  })
})

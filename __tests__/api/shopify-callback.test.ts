/**
 * Teste focado para app/api/shopify/callback/route.ts — validação
 * independente do domínio "shop" antes de qualquer fetch() externo (P16).
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: jest.fn() } }))
jest.mock('@/lib/app-settings', () => ({ getSetting: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/ai-crypto', () => ({
  encryptSecret: jest.fn(),
  decryptSecret: jest.fn(),
}))
jest.mock('@/lib/shopify-confirmation-service', () => ({
  SHOPIFY_INTEGRATION_PUBLIC_SELECT: 'id',
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/shopify/callback/route')

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SHOPIFY_CLIENT_ID = 'client-id'
  process.env.SHOPIFY_CLIENT_SECRET = 'client-secret'
  process.env.APP_BASE_URL = 'https://app.example.com'
})

function req(shop: string) {
  const params = new URLSearchParams({
    shop,
    code: 'abc',
    state: 'nonce',
    hmac: 'whatever',
  })
  return new NextRequest(`http://localhost/api/shopify/callback?${params.toString()}`)
}

describe('GET /api/shopify/callback — validação de domínio', () => {
  it('rejeita domínio que não termina em .myshopify.com, sem chamar fetch', async () => {
    const res = await GET(req('malicious.internal-service.local'))
    expect(res.status).toBe(307) // redirect
    expect(fetchMock).not.toHaveBeenCalled()
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('shopifyError')
  })

  it('rejeita domínio com userinfo/porta tentando escapar do host esperado', async () => {
    const res = await GET(req('loja.myshopify.com@evil.com'))
    expect(res.status).toBe(307)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejeita IP literal disfarçado', async () => {
    const res = await GET(req('169.254.169.254'))
    expect(res.status).toBe(307)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passa da validação de domínio para um shop legítimo (falha depois, no HMAC, mas não por causa do domínio)', async () => {
    const res = await GET(req('loja-legitima.myshopify.com'))
    // Sem o cookie de estado / HMAC correto o fluxo falha adiante, mas o
    // importante aqui é que passou da checagem de domínio sem cair no
    // "Domínio inválido".
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('Dom%C3%ADnio+inv%C3%A1lido')
  })
})

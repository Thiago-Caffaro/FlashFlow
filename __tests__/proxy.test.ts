/**
 * Testes de integração do proxy.ts (middleware global de /api/*).
 *
 * Diferente de testar apenas os handlers de rota importados diretamente, estes
 * testes exercitam a função `proxy` real que decide, antes de qualquer rota,
 * se a requisição precisa do cookie de sessão administrativa (ff_auth) ou é
 * pública. Isso cobre a classe de bug em que uma rota pública por design
 * (webhook servidor-a-servidor) acaba bloqueada pelo proxy antes de chegar à
 * própria verificação de autenticação da rota (HMAC, segredo de webhook, etc).
 */

import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { AUTH_COOKIE, generateAuthToken } from '@/lib/server-auth'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_SECRET: 'test-auth-secret' }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

function requestFor(path: string, opts: { cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = `${AUTH_COOKIE}=${opts.cookie}`
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers })
}

function isPassthrough(res: ReturnType<typeof proxy>): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

describe('proxy — webhooks servidor-a-servidor (sem cookie)', () => {
  it('libera POST /api/webhook/shopify/orders sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/shopify/orders'))
    expect(isPassthrough(res)).toBe(true)
  })

  it('libera POST /api/webhook/shopify/abandoned-checkouts sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/shopify/abandoned-checkouts'))
    expect(isPassthrough(res)).toBe(true)
  })

  it('libera POST /api/webhook/evolution sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/evolution'))
    expect(isPassthrough(res)).toBe(true)
  })
})

describe('proxy — não libera caminhos parecidos por prefixo', () => {
  it('bloqueia /api/webhook/shopify/orders-evil sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/shopify/orders-evil'))
    expect(res.status).toBe(401)
  })

  it('bloqueia /api/webhook/evolution-debug sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/evolution-debug'))
    expect(res.status).toBe(401)
  })

  it('bloqueia subcaminho /api/webhook/shopify/orders/extra sem cookie', () => {
    const res = proxy(requestFor('/api/webhook/shopify/orders/extra'))
    expect(res.status).toBe(401)
  })

  it('bloqueia /api/auth/login-admin sem cookie (não é /api/auth/login exato)', () => {
    const res = proxy(requestFor('/api/auth/login-admin'))
    expect(res.status).toBe(401)
  })
})

describe('proxy — rotas administrativas exigem cookie válido', () => {
  it('bloqueia API administrativa sem cookie', () => {
    const res = proxy(requestFor('/api/accounts'))
    expect(res.status).toBe(401)
  })

  it('bloqueia API administrativa com cookie inválido/corrompido', () => {
    const res = proxy(requestFor('/api/accounts', { cookie: 'garbage.not-a-real-token' }))
    expect(res.status).toBe(401)
  })

  it('libera API administrativa com cookie de sessão válido', () => {
    const token = generateAuthToken('admin')
    const res = proxy(requestFor('/api/accounts', { cookie: token }))
    expect(isPassthrough(res)).toBe(true)
  })

  it('libera /api/auth/login e /api/auth/verify sem cookie (pré-login)', () => {
    expect(isPassthrough(proxy(requestFor('/api/auth/login')))).toBe(true)
    expect(isPassthrough(proxy(requestFor('/api/auth/verify')))).toBe(true)
  })
})

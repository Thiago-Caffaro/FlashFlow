import { NextRequest } from 'next/server'
import { AUTH_COOKIE, generateAuthToken, isAdminRequest, verifyAuthToken } from '@/lib/server-auth'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_SECRET: 'test-secret' }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

function reqWith(opts: { cookie?: string; bearer?: string }): NextRequest {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = `${AUTH_COOKIE}=${opts.cookie}`
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return new NextRequest('http://localhost/api/accounts', { headers })
}

describe('generateAuthToken / verifyAuthToken', () => {
  it('gera um token que verifica como válido', () => {
    const token = generateAuthToken('admin')
    expect(verifyAuthToken(token)).toBe(true)
  })

  it('rejeita token com assinatura adulterada', () => {
    const token = generateAuthToken('admin')
    const [payload] = token.split('.')
    expect(verifyAuthToken(`${payload}.adulterada`)).toBe(false)
  })

  it('rejeita token com payload adulterado (mesma assinatura)', () => {
    const token = generateAuthToken('admin')
    const [, sig] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ u: 'outro', exp: Date.now() + 999999 })).toString('base64url')
    expect(verifyAuthToken(`${forgedPayload}.${sig}`)).toBe(false)
  })

  it('rejeita token expirado', () => {
    const realNow = Date.now
    Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000 // gerado como se fosse há 8 dias (sessão dura 7)
    const token = generateAuthToken('admin')
    Date.now = realNow
    expect(verifyAuthToken(token)).toBe(false)
  })

  it('rejeita token malformado (sem duas partes)', () => {
    expect(verifyAuthToken('token-sem-ponto')).toBe(false)
  })

  it('rejeita token ausente', () => {
    expect(verifyAuthToken(undefined)).toBe(false)
  })

  it('rejeita string vazia', () => {
    expect(verifyAuthToken('')).toBe(false)
  })
})

describe('isAdminRequest — contrato único via cookie', () => {
  it('aceita requisição com cookie de sessão válido', () => {
    const token = generateAuthToken('admin')
    expect(isAdminRequest(reqWith({ cookie: token }))).toBe(true)
  })

  it('rejeita requisição sem cookie e sem header', () => {
    expect(isAdminRequest(reqWith({}))).toBe(false)
  })

  it('rejeita requisição que só tem Authorization: Bearer (sem suporte a Bearer)', () => {
    const token = generateAuthToken('admin')
    expect(isAdminRequest(reqWith({ bearer: token }))).toBe(false)
  })

  it('rejeita cookie inválido mesmo com Bearer válido presente', () => {
    const token = generateAuthToken('admin')
    expect(isAdminRequest(reqWith({ cookie: 'garbage', bearer: token }))).toBe(false)
  })
})

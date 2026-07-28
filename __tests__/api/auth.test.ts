import { NextRequest } from 'next/server'
import { AUTH_COOKIE, generateAuthToken } from '@/lib/server-auth'
import { _resetLoginRateLimitForTests } from '@/lib/login-rate-limit'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_SECRET: 'test-secret',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'super-secret-pass',
  }
  _resetLoginRateLimitForTests()
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST: loginPost } = require('@/app/api/auth/login/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET: verifyGet, POST: verifyPost } = require('@/app/api/auth/verify/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST: logoutPost } = require('@/app/api/auth/logout/route')

function loginReq(body: unknown, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/login', () => {
  it('autentica com credenciais corretas, seta cookie HttpOnly e nunca retorna o token no corpo', async () => {
    const res = await loginPost(loginReq({ username: 'admin', password: 'super-secret-pass' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(json.token).toBeUndefined()

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${AUTH_COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  it('rejeita senha errada com o mesmo tamanho da correta', async () => {
    const res = await loginPost(loginReq({ username: 'admin', password: 'xxxxxxxxxxxxxxxxx' }, '2.0.0.1'))
    expect(res.status).toBe(401)
  })

  it('rejeita usuário errado mais curto sem lançar exceção', async () => {
    const res = await loginPost(loginReq({ username: 'ad', password: 'super-secret-pass' }, '2.0.0.2'))
    expect(res.status).toBe(401)
  })

  it('rejeita usuário errado mais longo sem lançar exceção', async () => {
    const res = await loginPost(loginReq({ username: 'admin-muito-mais-longo-que-o-real', password: 'super-secret-pass' }, '2.0.0.3'))
    expect(res.status).toBe(401)
  })

  it('não vaza o tamanho do usuário correto via status code (mesmo status para tamanhos diferentes)', async () => {
    const sameLength = await loginPost(loginReq({ username: 'bdmin', password: 'super-secret-pass' }, '3.0.0.1'))
    const diffLength = await loginPost(loginReq({ username: 'bd', password: 'super-secret-pass' }, '3.0.0.2'))
    expect(sameLength.status).toBe(401)
    expect(diffLength.status).toBe(401)
  })

  it('rejeita quando username ou password estão ausentes', async () => {
    const res = await loginPost(loginReq({ username: 'admin' }, '2.0.0.4'))
    expect(res.status).toBe(400)
  })

  it('rejeita quando username/password não são strings', async () => {
    const res = await loginPost(loginReq({ username: 123, password: { a: 1 } }, '2.0.0.5'))
    expect(res.status).toBe(400)
  })

  it('rejeita JSON inválido', async () => {
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '2.0.0.6' },
      body: '{not-json',
    })
    const res = await loginPost(req)
    expect(res.status).toBe(400)
  })

  it('bloqueia com 429 após exceder o limite de tentativas do mesmo IP+usuário', async () => {
    for (let i = 0; i < 5; i++) {
      await loginPost(loginReq({ username: 'admin', password: 'wrong' }, '4.4.4.4'))
    }
    const res = await loginPost(loginReq({ username: 'admin', password: 'wrong' }, '4.4.4.4'))
    expect(res.status).toBe(429)
  })

  it('retorna 500 quando ADMIN_PASSWORD não está configurado no servidor', async () => {
    process.env.ADMIN_PASSWORD = ''
    const res = await loginPost(loginReq({ username: 'admin', password: 'x' }, '5.5.5.5'))
    expect(res.status).toBe(500)
  })
})

describe('POST/GET /api/auth/verify', () => {
  it('retorna ok=true com cookie de sessão válido', async () => {
    const token = generateAuthToken('admin')
    const req = new NextRequest('http://localhost/api/auth/verify', {
      method: 'GET',
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
    })
    expect(await (await verifyGet(req)).json()).toEqual({ ok: true })
  })

  it('retorna ok=false sem cookie', async () => {
    const req = new NextRequest('http://localhost/api/auth/verify', { method: 'GET' })
    expect(await (await verifyGet(req)).json()).toEqual({ ok: false })
  })

  it('retorna ok=false com cookie inválido/corrompido', async () => {
    const req = new NextRequest('http://localhost/api/auth/verify', {
      method: 'GET',
      headers: { cookie: `${AUTH_COOKIE}=garbage.notreal` },
    })
    expect(await (await verifyGet(req)).json()).toEqual({ ok: false })
  })

  it('retorna ok=false para sessão expirada', async () => {
    const realNow = Date.now
    Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000
    const token = generateAuthToken('admin')
    Date.now = realNow

    const req = new NextRequest('http://localhost/api/auth/verify', {
      method: 'GET',
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
    })
    expect(await (await verifyGet(req)).json()).toEqual({ ok: false })
  })

  it('ignora token enviado no corpo — apenas o cookie HttpOnly é fonte de autorização', async () => {
    const token = generateAuthToken('admin')
    const req = new NextRequest('http://localhost/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    // Sem cookie — mesmo com um token válido no corpo (comportamento legado),
    // a verificação deve falhar, pois o corpo não é mais uma fonte confiável.
    expect(await (await verifyPost(req)).json()).toEqual({ ok: false })
  })
})

describe('POST /api/auth/logout', () => {
  it('limpa o cookie de sessão com os mesmos atributos usados na criação', async () => {
    const res = await logoutPost()
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${AUTH_COOKIE}=`)
    expect(setCookie).toMatch(/max-age=0/i)
    expect(setCookie.toLowerCase()).toContain('httponly')
  })
})

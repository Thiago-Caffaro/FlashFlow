import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, generateAuthToken, SESSION_MAX_AGE_SECONDS } from '@/lib/server-auth'
import { checkLoginRateLimit, getClientIp } from '@/lib/login-rate-limit'

/** Compara em tempo constante, sem lançar exceção quando os tamanhos diferem. */
function safeEqual(a: string, b: string): boolean {
  const actual = Buffer.from(a, 'utf8')
  const expected = Buffer.from(b, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    const body: unknown = await req.json()
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
    }

    const { username, password } = body as Record<string, unknown>
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
    }

    if (!checkLoginRateLimit(ip, username)) {
      console.warn(`[auth] login rate limited ip=${ip}`)
      return NextResponse.json({ ok: false, error: 'Muitas tentativas. Tente novamente em instantes.' }, { status: 429 })
    }

    const expectedUser = process.env.ADMIN_USERNAME ?? 'admin'
    const expectedPass = process.env.ADMIN_PASSWORD
    if (!expectedPass) {
      return NextResponse.json({ ok: false, error: 'Servidor não configurado (ADMIN_PASSWORD ausente)' }, { status: 500 })
    }

    // Comparação de tamanho constante primeiro (não é segredo em si — o
    // padrão já era usado para a senha) evita RangeError do timingSafeEqual
    // quando os buffers têm tamanhos diferentes, o que antes vazava um sinal
    // de enumeração (400 vs 401) para tamanhos de usuário incorretos.
    const userMatch = safeEqual(username, expectedUser)
    const passMatch = safeEqual(password, expectedPass)
    if (!userMatch || !passMatch) {
      console.warn(`[auth] login failed ip=${ip}`)
      return NextResponse.json({ ok: false, error: 'Credenciais inválidas' }, { status: 401 })
    }

    console.log(`[auth] login success ip=${ip}`)
    const token = generateAuthToken(username)
    // O token nunca volta no corpo JSON nem é acessível via JavaScript no
    // cliente — apenas o cookie HttpOnly carrega a sessão.
    const response = NextResponse.json({ ok: true })
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE !== 'false',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
    return response
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
  }
}

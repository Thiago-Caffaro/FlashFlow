import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, generateAuthToken } from '@/lib/server-auth'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()
    const expectedUser = process.env.ADMIN_USERNAME ?? 'admin'
    const expectedPass = process.env.ADMIN_PASSWORD

    if (!expectedPass) {
      return NextResponse.json({ ok: false, error: 'Servidor não configurado (ADMIN_PASSWORD ausente)' }, { status: 500 })
    }

    const { timingSafeEqual } = await import('node:crypto')
    const userMatch = timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser))
    const passMatch = expectedPass.length === password.length &&
      timingSafeEqual(Buffer.from(password), Buffer.from(expectedPass))
    if (!userMatch || !passMatch) {
      return NextResponse.json({ ok: false, error: 'Credenciais inválidas' }, { status: 401 })
    }

    const token = generateAuthToken(username)
    const response = NextResponse.json({ ok: true, token })
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE !== 'false',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
  }
}

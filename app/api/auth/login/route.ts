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

    if (username !== expectedUser || password !== expectedPass) {
      return NextResponse.json({ ok: false, error: 'Credenciais inválidas' }, { status: 401 })
    }

    const token = generateAuthToken(username)
    const response = NextResponse.json({ ok: true, token })
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
  }
}

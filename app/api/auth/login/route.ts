import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

function generateToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const secret = process.env.AUTH_SECRET ?? 'fallback-secret-change-in-env'
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

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

    return NextResponse.json({ ok: true, token: generateToken(username) })
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida' }, { status: 400 })
  }
}

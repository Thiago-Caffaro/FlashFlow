import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'

export const AUTH_COOKIE = 'ff_auth'

// Sessão administrativa: 7 dias (antes 30). Não há tabela de sessões — a
// revogação de todas as sessões ativas é feita rotacionando AUTH_SECRET, o
// que invalida a assinatura HMAC de qualquer token emitido anteriormente.
// Ao trocar ADMIN_PASSWORD em produção, rotacione AUTH_SECRET junto para
// forçar o logout de sessões antigas.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET não configurado — defina no .env.local')
  return secret
}

export function generateAuthToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  })).toString('base64url')
  const sig = createHmac('sha256', getAuthSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyAuthToken(token: string | undefined): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false

  const [payload, sig] = parts
  const secret = getAuthSecret()
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const actualBuffer = Buffer.from(sig)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number }
    return typeof data.exp === 'number' && Date.now() <= data.exp
  } catch {
    return false
  }
}

// Contrato único: sessão administrativa via cookie HttpOnly (ff_auth).
// Não há suporte a Authorization: Bearer para esta sessão — o proxy global
// (proxy.ts) já exige o cookie em todo /api/:path*, então um header Bearer
// nunca alcançaria uma rota que não o aceitasse primeiro no proxy.
export function isAdminRequest(req: NextRequest): boolean {
  return verifyAuthToken(req.cookies.get(AUTH_COOKIE)?.value)
}


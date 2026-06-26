import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'

export const AUTH_COOKIE = 'ff_auth'

export function generateAuthToken(username: string): string {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const secret = process.env.AUTH_SECRET ?? 'fallback-secret-change-in-env'
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyAuthToken(token: string | undefined): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false

  const [payload, sig] = parts
  const secret = process.env.AUTH_SECRET ?? 'fallback-secret-change-in-env'
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

export function isAdminRequest(req: NextRequest): boolean {
  const cookieToken = req.cookies.get(AUTH_COOKIE)?.value
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return verifyAuthToken(cookieToken ?? bearer)
}


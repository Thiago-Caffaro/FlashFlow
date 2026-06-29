import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/server-auth'

function buildResponse(token: string | undefined, existingCookie: string | undefined) {
  const ok = verifyAuthToken(token)
  const res = NextResponse.json({ ok })
  if (ok && token && !existingCookie) {
    res.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE !== 'false',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
  }
  return res
}

// POST — token in request body (preferred, token never in URL)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: string }
  const cookieToken = req.cookies.get(AUTH_COOKIE)?.value
  const token = cookieToken ?? body.token
  return buildResponse(token, cookieToken)
}

// GET — cookie-only (no query param fallback, legacy GET still works for server-to-server)
export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get(AUTH_COOKIE)?.value
  return buildResponse(cookieToken, cookieToken)
}

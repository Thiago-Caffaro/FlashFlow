import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/server-auth'

export async function GET(req: NextRequest) {
  const queryToken = req.nextUrl.searchParams.get('token') ?? undefined
  const token = req.cookies.get(AUTH_COOKIE)?.value ?? queryToken
  const ok = verifyAuthToken(token)
  const response = NextResponse.json({ ok })
  if (ok && queryToken && !req.cookies.get(AUTH_COOKIE)?.value) {
    response.cookies.set(AUTH_COOKIE, queryToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
  }
  return response
}

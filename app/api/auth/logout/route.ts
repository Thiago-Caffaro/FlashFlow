import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/server-auth'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: 0,
  })
  return response
}


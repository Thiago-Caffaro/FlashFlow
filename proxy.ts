import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/server-auth'

const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/verify',
  '/api/webhook/evolution',
]

export function proxy(req: NextRequest) {
  if (PUBLIC_API_PATHS.some((path) => req.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next()
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!verifyAuthToken(token)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}


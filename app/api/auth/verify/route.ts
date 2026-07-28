import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/server-auth'

// Autenticação baseada exclusivamente no cookie HttpOnly — nunca aceita um
// token vindo do corpo da requisição. O frontend não tem (e não deve ter)
// acesso ao valor do token; ele só existe no cookie.
function buildResponse(cookieToken: string | undefined) {
  const ok = verifyAuthToken(cookieToken)
  return NextResponse.json({ ok })
}

export async function POST(req: NextRequest) {
  return buildResponse(req.cookies.get(AUTH_COOKIE)?.value)
}

export async function GET(req: NextRequest) {
  return buildResponse(req.cookies.get(AUTH_COOKIE)?.value)
}

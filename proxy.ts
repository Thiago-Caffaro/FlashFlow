import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/server-auth'

// Endpoints servidor-a-servidor que nunca terão o cookie de sessão administrativa
// (webhooks de terceiros) ou que precisam ser alcançáveis antes de existir sessão
// (login, verificação de sessão). Cada rota tem sua própria autenticação interna
// (segredo de webhook, HMAC, etc.) — este é apenas o gate do cookie ff_auth.
// Comparação por igualdade exata do pathname, nunca por prefixo, para não liberar
// acidentalmente rotas parecidas (ex: /api/webhook/evolution-debug).
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/verify',
  '/api/auth/logout',
  '/api/webhook/evolution',
  '/api/webhook/shopify/orders',
  '/api/webhook/shopify/abandoned-checkouts',
  '/api/webhook/shopify/draft-orders',
  '/api/webhook/lightfunnels',
  '/api/webhook/whatsapp-cloud',
  '/api/webhook/slack/interactivity',
])

export function proxy(req: NextRequest) {
  if (PUBLIC_API_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next()
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!verifyAuthToken(token)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}


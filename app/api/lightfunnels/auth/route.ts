import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { LIGHTFUNNELS_OAUTH_URL } from '@/lib/lightfunnels-client'
import { getLightfunnelsAppBaseUrl, getLightfunnelsAppCredentials } from '@/lib/lightfunnels-integration-store'
import { LIGHTFUNNELS_OAUTH_STATE_COOKIE, encodeLightfunnelsOAuthState } from '@/lib/lightfunnels-oauth-state'

export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// POST /api/lightfunnels/auth — prepara o OAuth de uma conta Lightfunnels e
// devolve a URL da tela de consentimento. O lojista escolhe a conta ao
// autorizar; o callback descobre qual foi pelo token.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const country = text(body.country).toUpperCase()
  const name = text(body.name).slice(0, 120)
  if (!country) return NextResponse.json({ ok: false, error: 'País padrão obrigatório' }, { status: 400 })

  try {
    const [app, appBaseUrl] = await Promise.all([getLightfunnelsAppCredentials(), getLightfunnelsAppBaseUrl()])
    if (!app.clientId || !app.clientSecret || !appBaseUrl) {
      return NextResponse.json({
        ok: false,
        error: 'Client ID/Secret do app Lightfunnels ou URL pública do app não configurados.',
      }, { status: 400 })
    }

    const nonce = randomBytes(16).toString('hex')
    const authUrl = `${LIGHTFUNNELS_OAUTH_URL}?` + new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: `${appBaseUrl}/api/lightfunnels/callback`,
      scope: app.scopes,
      state: nonce,
    }).toString()

    const res = NextResponse.json({ ok: true, authUrl })
    res.cookies.set(LIGHTFUNNELS_OAUTH_STATE_COOKIE, encodeLightfunnelsOAuthState({ nonce, country, name }), {
      httpOnly: true,
      maxAge: 600,
      path: '/',
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE !== 'false',
    })
    return res
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao iniciar a conexão com o Lightfunnels',
    }, { status: 500 })
  }
}

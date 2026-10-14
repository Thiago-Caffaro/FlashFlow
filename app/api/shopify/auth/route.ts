import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeShopDomain } from '@/lib/shopify-client'
import { getSetting } from '@/lib/app-settings'
import { getShopifyAppCredentials, loadShopifyAppFieldsByDomain } from '@/lib/shopify-integration-store'
import { SHOPIFY_OAUTH_STATE_COOKIE, encodeShopifyOAuthState } from '@/lib/shopify-oauth-state'

export const dynamic = 'force-dynamic'

interface AuthBody {
  shop?: unknown
  country?: unknown
  clientId?: unknown
  clientSecret?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// POST /api/shopify/auth — prepara o OAuth de uma loja e devolve a URL de
// autorização. É POST (não um link GET) porque pode levar o Client Secret do
// app próprio da loja, que nunca deve aparecer em URL nem em log de acesso.
//
// Qual app usar:
//   1. clientId + clientSecret no corpo → app próprio novo da loja;
//   2. loja já salva com app próprio → o mesmo app (reconexão);
//   3. senão → app global (Credenciais do App Shopify).
export async function POST(req: NextRequest) {
  let body: AuthBody
  try {
    body = await req.json() as AuthBody
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const shop = normalizeShopDomain(text(body.shop))
  const country = text(body.country).toUpperCase()
  const clientId = text(body.clientId)
  const clientSecret = text(body.clientSecret)

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return NextResponse.json({ ok: false, error: 'Domínio inválido — use o formato loja.myshopify.com' }, { status: 400 })
  }
  if (!country) {
    return NextResponse.json({ ok: false, error: 'País padrão obrigatório' }, { status: 400 })
  }
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    return NextResponse.json({ ok: false, error: 'Preencha Client ID e Client Secret do app da loja, ou deixe os dois vazios para usar o app global' }, { status: 400 })
  }

  try {
    const [scopesDb, appBaseUrlDb] = await Promise.all([
      getSetting('shopify_scopes'),
      getSetting('shopify_app_base_url'),
    ])
    const appBaseUrl = appBaseUrlDb ?? process.env.APP_BASE_URL ?? ''
    const scopes = scopesDb ?? process.env.SHOPIFY_SCOPES ?? 'read_orders,read_products,read_checkouts,read_inventory'

    const newApp = clientId ? { clientId, clientSecret } : undefined
    const effectiveClientId = newApp
      ? newApp.clientId
      : (await getShopifyAppCredentials(await loadShopifyAppFieldsByDomain(shop))).clientId

    if (!effectiveClientId || !appBaseUrl) {
      return NextResponse.json({
        ok: false,
        error: 'Client ID do app ou URL do App não configurados — preencha as credenciais do app da loja ou as Credenciais do App Shopify.',
      }, { status: 400 })
    }

    const nonce = randomBytes(16).toString('hex')
    const authUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: effectiveClientId,
      scope: scopes,
      redirect_uri: `${appBaseUrl}/api/shopify/callback`,
      state: nonce,
    }).toString()

    const res = NextResponse.json({ ok: true, authUrl })
    res.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, encodeShopifyOAuthState({ nonce, country, ...(newApp ? { app: newApp } : {}) }), {
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
      error: error instanceof Error ? error.message : 'Falha ao iniciar a conexão com o Shopify',
    }, { status: 500 })
  }
}

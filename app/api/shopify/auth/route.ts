import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeShopDomain } from '@/lib/shopify-client'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const shop = normalizeShopDomain(req.nextUrl.searchParams.get('shop') ?? '')
  const country = (req.nextUrl.searchParams.get('country') ?? '').toUpperCase().trim()

  const [clientIdDb, scopesDb, appBaseUrlDb] = await Promise.all([
    getSetting('shopify_client_id'),
    getSetting('shopify_scopes'),
    getSetting('shopify_app_base_url'),
  ])
  const clientId = clientIdDb ?? process.env.SHOPIFY_CLIENT_ID
  const appBaseUrl = appBaseUrlDb ?? process.env.APP_BASE_URL
  const scopes = scopesDb ?? process.env.SHOPIFY_SCOPES ?? 'read_orders,read_products,read_checkouts,read_inventory'

  if (!clientId || !appBaseUrl) {
    return NextResponse.json({ ok: false, error: 'SHOPIFY_CLIENT_ID / APP_BASE_URL não configurado — acesse Configurações → Shopify para preencher.' }, { status: 500 })
  }
  if (!shop.endsWith('.myshopify.com')) {
    return NextResponse.redirect(`${appBaseUrl}/fulfillment?shopifyError=${encodeURIComponent('Domínio inválido — use o formato loja.myshopify.com')}`)
  }
  if (!country) {
    return NextResponse.redirect(`${appBaseUrl}/fulfillment?shopifyError=${encodeURIComponent('País padrão obrigatório')}`)
  }

  const nonce = randomBytes(16).toString('hex')
  const cookieValue = Buffer.from(JSON.stringify({ nonce, country })).toString('base64')
  const redirectUri = `${appBaseUrl}/api/shopify/callback`

  const authUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: nonce,
  }).toString()

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('shopify_oauth_state', cookieValue, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return res
}

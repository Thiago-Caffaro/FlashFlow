import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/ai-crypto'
import { normalizeShopDomain } from '@/lib/shopify-client'
import { SHOPIFY_INTEGRATION_PUBLIC_SELECT } from '@/lib/shopify-confirmation-service'
import { ensureOrderCreateWebhookRegisteredWithToken } from '@/lib/shopify-webhook-setup'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getShopifyAppCredentials, loadShopifyAppFieldsByDomain } from '@/lib/shopify-integration-store'
import { SHOPIFY_OAUTH_STATE_COOKIE, decodeShopifyOAuthState } from '@/lib/shopify-oauth-state'

export const dynamic = 'force-dynamic'

function encryptedTokenPatch(value: string) {
  const encrypted = encryptSecret(value)
  return {
    encrypted_admin_token: encrypted.encrypted_key,
    admin_token_iv: encrypted.iv,
    admin_token_auth_tag: encrypted.auth_tag,
  }
}

function encryptedAppSecretPatch(clientId: string, clientSecret: string) {
  const encrypted = encryptSecret(clientSecret)
  return {
    app_client_id: clientId,
    encrypted_app_client_secret: encrypted.encrypted_key,
    app_client_secret_iv: encrypted.iv,
    app_client_secret_auth_tag: encrypted.auth_tag,
  }
}

function hmacEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const appBaseUrl = (await getSetting('shopify_app_base_url')) ?? process.env.APP_BASE_URL ?? ''

  function fail(msg: string) {
    return NextResponse.redirect(`${appBaseUrl}/fulfillment?shopifyError=${encodeURIComponent(msg)}`)
  }

  if (!appBaseUrl) return fail('Configuração OAuth incompleta no servidor')

  const params = req.nextUrl.searchParams
  const hmac = params.get('hmac') ?? ''
  const shop = params.get('shop') ?? ''
  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''

  if (!code || !shop || !state || !hmac) return fail('Parâmetros OAuth ausentes')

  // Validação independente do domínio — não depende só do HMAC. O shop.json
  // e o access_token endpoint abaixo fazem fetch() para este host; sem esta
  // checagem, um bug futuro na verificação do HMAC (ou uma chave vazada)
  // abriria uma janela de SSRF via o parâmetro "shop".
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return fail('Domínio inválido — use o formato loja.myshopify.com')
  }

  // Step 1 — Estado do cookie (cifrado pelo servidor). Vem antes do HMAC
  // porque diz qual app assina este callback: o app próprio da loja ou o
  // global.
  const cookieRaw = req.cookies.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value
  if (!cookieRaw) return fail('Cookie de estado expirado — tente novamente')
  const cookieData = decodeShopifyOAuthState(cookieRaw)
  if (!cookieData) return fail('Cookie de estado inválido ou corrompido')

  const nonceA = Buffer.from(cookieData.nonce, 'utf8')
  const nonceB = Buffer.from(state, 'utf8')
  if (nonceA.length !== nonceB.length || !timingSafeEqual(nonceA, nonceB)) {
    return fail('Estado OAuth não confere')
  }
  const country = cookieData.country.toUpperCase()

  let clientId: string
  let clientSecret: string
  try {
    const credentials = cookieData.app
      ?? await getShopifyAppCredentials(await loadShopifyAppFieldsByDomain(shop))
    clientId = credentials.clientId
    clientSecret = credentials.clientSecret
  } catch {
    return fail('Falha ao carregar as credenciais do app Shopify')
  }
  if (!clientId || !clientSecret) return fail('Configuração OAuth incompleta no servidor')

  // Step 2 — Verify HMAC
  const sortedMessage = Array.from(params.entries())
    .filter(([k]) => k !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const expectedHmac = createHmac('sha256', clientSecret).update(sortedMessage).digest('hex')
  if (!hmacEqual(expectedHmac, hmac)) return fail('Assinatura HMAC inválida — confira se o Client Secret do app está correto')

  // Step 3 — Exchange code for access token
  let accessToken: string
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
    if (!tokenRes.ok) return fail(`Falha ao obter token Shopify (${tokenRes.status})`)
    const tokenJson = await tokenRes.json() as { access_token?: string; error_description?: string }
    if (!tokenJson.access_token) return fail(tokenJson.error_description ?? 'Token não retornado pelo Shopify')
    accessToken = tokenJson.access_token
  } catch {
    return fail('Erro de rede ao contatar Shopify')
  }

  // Step 4 — Fetch shop name
  let shopName = shop
  try {
    const shopRes = await fetch(`https://${shop}/admin/api/2025-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    })
    if (shopRes.ok) {
      const shopJson = await shopRes.json() as { shop?: { name?: string } }
      shopName = shopJson.shop?.name ?? shop
    }
  } catch {
    // Non-fatal: fall back to domain as name
  }

  // Step 5 — Save to DB (upsert by shop_domain)
  const normalizedDomain = normalizeShopDomain(shop)
  const { error: dbError } = await supabaseAdmin
    .from('shopify_integrations')
    .upsert(
      {
        shop_name: shopName,
        shop_domain: normalizedDomain,
        default_country: country,
        ...encryptedTokenPatch(accessToken),
        // App próprio novo: só é gravado depois de o OAuth provar que o
        // Client ID/Secret estão certos.
        ...(cookieData.app ? encryptedAppSecretPatch(cookieData.app.clientId, cookieData.app.clientSecret) : {}),
        oauth_connected: true,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' },
    )
    .select(SHOPIFY_INTEGRATION_PUBLIC_SELECT)

  if (dbError) return fail(`Erro ao salvar integração: ${dbError.message}`)

  // Step 5.5 — Register the orders/create webhook so new orders arrive in
  // real time, instead of relying on the merchant to configure this manually
  // in Shopify Admin → Settings → Notifications. Best-effort: a failure here
  // doesn't block the OAuth connection — the store still works via manual sync.
  let webhookWarning = ''
  const webhookResult = await ensureOrderCreateWebhookRegisteredWithToken(normalizedDomain, accessToken)
  if (!webhookResult.ok) webhookWarning = webhookResult.error ?? 'Falha ao registrar webhook de pedidos'

  // Step 6 — Success redirect, clear state cookie
  const successParams = new URLSearchParams({ shopifyConnected: '1' })
  if (webhookWarning) successParams.set('shopifyWebhookWarning', webhookWarning)
  const res = NextResponse.redirect(`${appBaseUrl}/fulfillment?${successParams.toString()}`)
  res.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { LightfunnelsClient } from '@/lib/lightfunnels-client'
import {
  encryptedTokenColumns,
  getLightfunnelsAppBaseUrl,
  getLightfunnelsAppCredentials,
  type LightfunnelsIntegrationCredentialRow,
} from '@/lib/lightfunnels-integration-store'
import { LIGHTFUNNELS_OAUTH_STATE_COOKIE, decodeLightfunnelsOAuthState } from '@/lib/lightfunnels-oauth-state'
import { requestLightfunnelsToken } from '@/lib/lightfunnels-token'
import { ensureLightfunnelsWebhooks } from '@/lib/lightfunnels-webhook-setup'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function sameNonce(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

// GET /api/lightfunnels/callback?code=...&state=... — fim do OAuth.
// A autenticação desta etapa é o nonce do cookie de state (cifrado no
// servidor e criado por um admin em /api/lightfunnels/auth).
export async function GET(req: NextRequest) {
  const appBaseUrl = await getLightfunnelsAppBaseUrl()
  if (!appBaseUrl) return NextResponse.json({ ok: false, error: 'URL pública do app não configurada' }, { status: 500 })

  function fail(msg: string) {
    const res = NextResponse.redirect(`${appBaseUrl}/fulfillment?lightfunnelsError=${encodeURIComponent(msg)}`)
    res.cookies.set(LIGHTFUNNELS_OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/' })
    return res
  }

  const params = req.nextUrl.searchParams
  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  if (!code || !state) return fail('Parâmetros OAuth ausentes')

  const cookieData = decodeLightfunnelsOAuthState(req.cookies.get(LIGHTFUNNELS_OAUTH_STATE_COOKIE)?.value ?? '')
  if (!cookieData || !sameNonce(cookieData.nonce, state)) {
    return fail('Estado OAuth inválido ou expirado — tente conectar de novo')
  }

  const app = await getLightfunnelsAppCredentials()
  if (!app.clientId || !app.clientSecret) return fail('Credenciais do app Lightfunnels não configuradas')

  let integrationRow: LightfunnelsIntegrationCredentialRow
  try {
    const tokens = await requestLightfunnelsToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${appBaseUrl}/api/lightfunnels/callback`,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    })
    const accountId = await new LightfunnelsClient(tokens.access_token).getAccountId()

    const { data, error } = await supabaseAdmin
      .from('lightfunnels_integrations')
      .upsert({
        lf_account_id: accountId,
        name: cookieData.name || `Lightfunnels ${accountId}`,
        default_country: cookieData.country,
        scopes: app.scopes,
        ...encryptedTokenColumns(tokens.access_token, tokens.refresh_token, tokens.expires_in),
        oauth_connected: true,
        active: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'lf_account_id' })
      .select('*')
      .single()
    if (error || !data) return fail(`Erro ao salvar integração: ${error?.message ?? 'resposta vazia'}`)
    integrationRow = data as LightfunnelsIntegrationCredentialRow
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Falha no OAuth do Lightfunnels')
  }

  // Best-effort, como na Shopify: falha aqui não desfaz a conexão — o admin
  // registra de novo pelo botão de webhooks.
  const webhookResult = await ensureLightfunnelsWebhooks(integrationRow)
  const successParams = new URLSearchParams({ lightfunnelsConnected: '1' })
  if (!webhookResult.ok) successParams.set('lightfunnelsWebhookWarning', webhookResult.error ?? 'Falha ao registrar webhooks')
  const res = NextResponse.redirect(`${appBaseUrl}/fulfillment?${successParams.toString()}`)
  res.cookies.set(LIGHTFUNNELS_OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}

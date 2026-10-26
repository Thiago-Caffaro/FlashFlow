import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_SHOPIFY_SCOPES, withRequiredShopifyScopes } from '@/lib/shopify-scopes'
import { isAdminRequest } from '@/lib/server-auth'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEYS = {
  clientId: 'shopify_client_id',
  clientSecret: 'shopify_client_secret',
  scopes: 'shopify_scopes',
  appBaseUrl: 'shopify_app_base_url',
} as const

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  const [clientId, clientSecretRaw, scopes, appBaseUrl] = await Promise.all([
    getSetting(KEYS.clientId),
    getSetting(KEYS.clientSecret),
    getSetting(KEYS.scopes),
    getSetting(KEYS.appBaseUrl),
  ])

  return NextResponse.json({
    ok: true,
    clientId: clientId ?? '',
    clientSecretSet: Boolean(clientSecretRaw),
    // Mostra o que de fato é pedido na autorização (obrigatórios incluídos).
    scopes: withRequiredShopifyScopes(scopes ?? process.env.SHOPIFY_SCOPES ?? DEFAULT_SHOPIFY_SCOPES),
    appBaseUrl: appBaseUrl ?? process.env.APP_BASE_URL ?? '',
  })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, string>
    const ops: Promise<void>[] = []

    if (body.clientId !== undefined && body.clientId.trim()) ops.push(setSetting(KEYS.clientId, body.clientId.trim()))
    if (body.clientSecret !== undefined && body.clientSecret.trim()) ops.push(setSetting(KEYS.clientSecret, body.clientSecret.trim()))
    if (body.scopes !== undefined && body.scopes.trim()) ops.push(setSetting(KEYS.scopes, body.scopes.trim()))
    if (body.appBaseUrl !== undefined && body.appBaseUrl.trim()) ops.push(setSetting(KEYS.appBaseUrl, body.appBaseUrl.trim().replace(/\/$/, '')))

    await Promise.all(ops)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}

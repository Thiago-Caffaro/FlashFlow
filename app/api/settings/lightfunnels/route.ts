import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { getSetting, setSetting } from '@/lib/app-settings'
import { LIGHTFUNNELS_DEFAULT_SCOPES } from '@/lib/lightfunnels-client'
import { getLightfunnelsAppBaseUrl, LIGHTFUNNELS_SETTING_KEYS } from '@/lib/lightfunnels-integration-store'

export const dynamic = 'force-dynamic'

// Credenciais do app de Partners do Lightfunnels (um app para todas as contas).
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  const [clientId, clientSecret, scopes, appBaseUrl] = await Promise.all([
    getSetting(LIGHTFUNNELS_SETTING_KEYS.clientId),
    getSetting(LIGHTFUNNELS_SETTING_KEYS.clientSecret),
    getSetting(LIGHTFUNNELS_SETTING_KEYS.scopes),
    getLightfunnelsAppBaseUrl(),
  ])

  return NextResponse.json({
    ok: true,
    clientId: clientId ?? '',
    clientSecretSet: Boolean(clientSecret),
    scopes: scopes ?? LIGHTFUNNELS_DEFAULT_SCOPES,
    redirectUri: appBaseUrl ? `${appBaseUrl}/api/lightfunnels/callback` : '',
  })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
    const ops: Promise<void>[] = []
    if (text(body.clientId)) ops.push(setSetting(LIGHTFUNNELS_SETTING_KEYS.clientId, text(body.clientId)))
    if (text(body.clientSecret)) ops.push(setSetting(LIGHTFUNNELS_SETTING_KEYS.clientSecret, text(body.clientSecret)))
    if (text(body.scopes)) ops.push(setSetting(LIGHTFUNNELS_SETTING_KEYS.scopes, text(body.scopes)))
    await Promise.all(ops)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}

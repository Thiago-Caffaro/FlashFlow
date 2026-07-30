import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import {
  getShopifyTriggersEnabled,
  setShopifyTriggersEnabled,
} from '@/lib/shopify-trigger-settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({
    ok: true,
    enabled: await getShopifyTriggersEnabled(),
  })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'enabled deve ser booleano' }, { status: 400 })
    }
    await setShopifyTriggersEnabled(body.enabled)
    return NextResponse.json({ ok: true, enabled: body.enabled })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import {
  getDefaultShopifyOrderInstance,
  setDefaultShopifyOrderInstance,
} from '@/lib/shopify-order-settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    return NextResponse.json({
      ok: true,
      instanceName: await getDefaultShopifyOrderInstance(),
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao carregar conta padrao',
    }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as { instanceName?: unknown }
    if (body.instanceName !== null && typeof body.instanceName !== 'string') {
      return NextResponse.json({ ok: false, error: 'instanceName invalido' }, { status: 400 })
    }
    const instanceName = await setDefaultShopifyOrderInstance(body.instanceName ?? null)
    return NextResponse.json({ ok: true, instanceName })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao salvar conta padrao',
    }, { status: 400 })
  }
}

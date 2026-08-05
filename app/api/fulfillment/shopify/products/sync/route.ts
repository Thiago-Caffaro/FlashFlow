import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { syncShopifyProductsForAllIntegrations } from '@/lib/shopify-products-service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const result = await syncShopifyProductsForAllIntegrations({
      integrationId: typeof body.integrationId === 'string' ? body.integrationId : undefined,
    })
    const ok = result.errors.length === 0
    return NextResponse.json({
      ok,
      ...result,
      error: ok ? undefined : `A sincronização falhou em ${result.errors.length} integração(ões).`,
    }, { status: ok ? 200 : 207 })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

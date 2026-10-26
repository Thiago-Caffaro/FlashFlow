import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { loadLightfunnelsIntegration } from '@/lib/lightfunnels-integration-store'
import { syncLightfunnelsOrders } from '@/lib/lightfunnels-order-service'
import { syncLightfunnelsProductsForIntegration } from '@/lib/lightfunnels-products-service'
import { lightfunnelsClientFor } from '@/lib/lightfunnels-token'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// POST /api/fulfillment/lightfunnels/integrations/[id]/sync — { orders?: boolean, products?: boolean }
// Backfill pela API. Pedidos importados não disparam gatilho (só entram na
// fila), como o sync da Shopify.
export async function POST(req: NextRequest, { params }: RouteContext) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const syncOrders = body.orders !== false
  const syncProducts = body.products !== false

  try {
    const integration = await loadLightfunnelsIntegration(id)
    if (!integration || !integration.active) {
      return NextResponse.json({ ok: false, error: 'Integração não encontrada ou inativa' }, { status: 404 })
    }
    const result: { orders?: number; products?: number } = {}
    if (syncProducts) {
      result.products = (await syncLightfunnelsProductsForIntegration(integration)).imported
    }
    if (syncOrders) {
      const client = await lightfunnelsClientFor(integration)
      result.orders = (await syncLightfunnelsOrders(
        integration,
        (after) => client.listOrdersPage({ first: 25, after }),
      )).imported
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 502 })
  }
}

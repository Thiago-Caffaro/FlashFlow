import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listActiveShopifyIntegrations,
  shopifyClientFromIntegration,
} from '@/lib/shopify-integration-store'
import { normalizeShopifyOrderTimeline } from '@/lib/shopify-order-timeline'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const { id } = await params
    const { data: order, error } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('source, shopify_integration_id, shopify_order_id')
      .eq('id', id)
      .single()

    if (error || !order) {
      return NextResponse.json({ ok: false, error: 'Pedido nao encontrado' }, { status: 404 })
    }
    if (order.source !== 'shopify' || !order.shopify_integration_id || !order.shopify_order_id) {
      return NextResponse.json({ ok: false, error: 'Pedido sem origem Shopify' }, { status: 400 })
    }

    const [integration] = await listActiveShopifyIntegrations(String(order.shopify_integration_id))
    if (!integration) {
      return NextResponse.json({ ok: false, error: 'Integracao Shopify inativa ou nao encontrada' }, { status: 404 })
    }

    const response = await shopifyClientFromIntegration(integration).getOrderEvents(
      String(order.shopify_order_id),
      { limit: 100 },
    )
    return NextResponse.json({
      ok: true,
      events: normalizeShopifyOrderTimeline(response),
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao consultar a Timeline Shopify',
    }, { status: 502 })
  }
}

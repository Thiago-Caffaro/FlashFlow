import { NextRequest, NextResponse } from 'next/server'
import { createFulfillmentOrder } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FULFILLMENT_ORDER_LIST_SELECT, toFulfillmentOrderListItem } from '@/lib/fulfillment-order-list'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const instance = req.nextUrl.searchParams.get('instance')
  const country = req.nextUrl.searchParams.get('country')
  let query = supabaseAdmin
    .from('fulfillment_orders')
    .select(FULFILLMENT_ORDER_LIST_SELECT)
    .is('shopify_deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (instance) query = query.eq('instance_name', instance)
  if (country) query = query.eq('country', country.toUpperCase())
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const rows = (data ?? []) as unknown as Parameters<typeof toFulfillmentOrderListItem>[0][]
  return NextResponse.json({ ok: true, orders: rows.map(toFulfillmentOrderListItem) })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const order = await createFulfillmentOrder(await req.json())
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}


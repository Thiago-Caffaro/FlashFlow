import { NextRequest, NextResponse } from 'next/server'
import { updateConfirmationOrder } from '@/lib/shopify-confirmation-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const [orderResult, eventResult] = await Promise.all([
    supabaseAdmin.from('fulfillment_orders').select('*').eq('id', id).single(),
    supabaseAdmin.from('fulfillment_order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ])
  if (orderResult.error) return NextResponse.json({ ok: false, error: orderResult.error.message }, { status: 404 })
  return NextResponse.json({ ok: true, order: orderResult.data, events: eventResult.data ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const { id } = await params
    const result = await updateConfirmationOrder(id, await req.json())
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

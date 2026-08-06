import { NextRequest, NextResponse } from 'next/server'
import { normalizeExternalDeliveryStatusKey } from '@/lib/fulfillment-delivery-status'
import { isDeliveryStatus } from '@/lib/order-state'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('fulfillment_delivery_status_mappings')
    .select('*')
    .order('delivery_status', { ascending: true, nullsFirst: true })
    .order('external_label')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mappings: data ?? [] })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const key = normalizeExternalDeliveryStatusKey(String(body?.external_status_key ?? ''))
  const deliveryStatus = body?.delivery_status === null ? null : String(body?.delivery_status ?? '')
  if (!key || (deliveryStatus !== null && !isDeliveryStatus(deliveryStatus))) {
    return NextResponse.json({ ok: false, error: 'Mapeamento inválido' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('fulfillment_delivery_status_mappings')
    .update({ delivery_status: deliveryStatus, updated_at: new Date().toISOString() })
    .eq('external_status_key', key)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Status externo não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true, mapping: data })
}

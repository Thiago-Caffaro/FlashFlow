import { NextRequest, NextResponse } from 'next/server'
import { FulfillmentApiError } from '@/lib/fulfillment-client'
import { getFulfillmentClient } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'

type SafeTestAction = 'connection' | 'stock'

// This endpoint intentionally exposes read-only operations only. It must never
// create, update, cancel, or delete external leads or local fulfillment orders.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json()
    const action = String(body.action ?? '') as SafeTestAction
    const country = String(body.country ?? '').trim().toUpperCase()
    const sku = String(body.sku ?? '').trim()

    if (!country || !['connection', 'stock'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'Ação de teste inválida' }, { status: 400 })
    }
    if (action === 'stock' && !sku) {
      return NextResponse.json({ ok: false, error: 'SKU obrigatório' }, { status: 400 })
    }

    const client = await getFulfillmentClient(country)
    const result = action === 'stock'
      ? await client.getStock(sku)
      : await client.getCountries()

    return NextResponse.json({ ok: true, action, result })
  } catch (error) {
    const upstreamStatus = error instanceof FulfillmentApiError ? error.status : undefined
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
      upstreamStatus,
    }, { status: upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502 })
  }
}

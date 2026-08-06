import { NextRequest, NextResponse } from 'next/server'
import { getFulfillmentClient } from '@/lib/fulfillment-service'
import { parsePackSku } from '@/lib/shopify-pack-quantity'
import { isAdminRequest } from '@/lib/server-auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const country = req.nextUrl.searchParams.get('country')
  if (!country) return NextResponse.json({ ok: false, error: 'country required' }, { status: 400 })
  try {
    const { sku } = await params
    const stock = await (await getFulfillmentClient(country.toUpperCase())).getStock(parsePackSku(sku).sku)
    return NextResponse.json({ ok: true, stock })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 502 })
  }
}

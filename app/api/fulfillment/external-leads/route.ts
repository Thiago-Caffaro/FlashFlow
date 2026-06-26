import { NextRequest, NextResponse } from 'next/server'
import { FulfillmentApiError } from '@/lib/fulfillment-client'
import { listExternalFulfillmentLeads } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const country = String(req.nextUrl.searchParams.get('country') ?? '').trim().toUpperCase()
    if (!country) return NextResponse.json({ ok: false, error: 'País obrigatório' }, { status: 400 })

    const leads = await listExternalFulfillmentLeads(country)
    return NextResponse.json({ ok: true, country, leads })
  } catch (error) {
    const upstreamStatus = error instanceof FulfillmentApiError ? error.status : undefined
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
      upstreamStatus,
    }, { status: upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502 })
  }
}

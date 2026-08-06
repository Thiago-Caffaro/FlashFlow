import { NextRequest, NextResponse } from 'next/server'
import { syncFulfillmentDeliveryIntegration } from '@/lib/fulfillment-delivery-sync'
import { isAdminRequest } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    const stats = await syncFulfillmentDeliveryIntegration(id)
    return NextResponse.json({ ok: true, stats })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao sincronizar entregas'
    const status = message.includes('ocupada') || message.includes('inativa') ? 409 : 502
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

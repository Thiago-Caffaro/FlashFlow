import { NextRequest, NextResponse } from 'next/server'
import { FulfillmentOrderSubmissionError, submitFulfillmentOrder } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const { id } = await params
    return NextResponse.json({ ok: true, order: await submitFulfillmentOrder(id) })
  } catch (error) {
    if (error instanceof FulfillmentOrderSubmissionError) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        status: error.submissionStatus,
        order: error.order,
      }, { status: error.submissionStatus === 'unknown' ? 504 : 502 })
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}

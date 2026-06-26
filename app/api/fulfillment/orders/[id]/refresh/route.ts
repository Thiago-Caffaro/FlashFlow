import { NextRequest, NextResponse } from 'next/server'
import { refreshFulfillmentOrder } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const { id } = await params
    return NextResponse.json({ ok: true, order: await refreshFulfillmentOrder(id) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}


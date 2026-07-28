import { NextRequest, NextResponse } from 'next/server'
import { syncShopifyData } from '@/lib/shopify-confirmation-service'
import { isAdminRequest } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const result = await syncShopifyData({
      integrationId: typeof body.integrationId === 'string' ? body.integrationId : undefined,
      limit: Number.isFinite(Number(body.limit)) ? Math.min(250, Math.max(1, Number(body.limit))) : 50,
      sendConfirmation: false,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

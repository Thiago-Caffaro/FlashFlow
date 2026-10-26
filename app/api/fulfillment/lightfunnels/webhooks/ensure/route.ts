import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { listActiveLightfunnelsIntegrations } from '@/lib/lightfunnels-integration-store'
import { ensureLightfunnelsWebhooks } from '@/lib/lightfunnels-webhook-setup'

export const dynamic = 'force-dynamic'

// POST /api/fulfillment/lightfunnels/webhooks/ensure — { integrationId?, force? }
// force recria todos (ex: mudou a URL pública do app).
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const integrationId = typeof body.integrationId === 'string' ? body.integrationId : undefined
    const integrations = await listActiveLightfunnelsIntegrations(integrationId)
    const results = []
    for (const integration of integrations) {
      if (!integration.oauth_connected) {
        results.push({ integrationId: integration.id, ok: false, created: 0, error: 'Conta desconectada — reconecte via OAuth' })
        continue
      }
      results.push(await ensureLightfunnelsWebhooks(integration, { force: body.force === true }))
    }
    return NextResponse.json({ ok: results.every((result) => result.ok), results })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

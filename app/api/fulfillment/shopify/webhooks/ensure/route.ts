import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { listActiveShopifyIntegrations } from '@/lib/shopify-integration-store'
import { ensureOrderCreateWebhookRegistered } from '@/lib/shopify-webhook-setup'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const integrationId = typeof body.integrationId === 'string' ? body.integrationId : undefined

  const integrations = await listActiveShopifyIntegrations(integrationId)
  const results = await Promise.all(integrations.map((integration) => ensureOrderCreateWebhookRegistered(integration)))

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
  })
}

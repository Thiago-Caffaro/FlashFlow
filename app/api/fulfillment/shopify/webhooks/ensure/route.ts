import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { listActiveShopifyIntegrations } from '@/lib/shopify-integration-store'
import { ensureOrderCreateWebhookRegistered } from '@/lib/shopify-webhook-setup'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const integrationId = typeof body.integrationId === 'string' ? body.integrationId : undefined

    const integrations = await listActiveShopifyIntegrations(integrationId)
    const results = await Promise.all(integrations.map((integration) => ensureOrderCreateWebhookRegistered(integration)))
    const ok = results.every((result) => result.ok)
    console.log(`[shopify-webhook] registration checked=${results.length} ok=${results.filter((result) => result.ok).length}`)
    // Uma linha por loja com falha: sem o motivo, "ok=0" não diz o que corrigir.
    for (const result of results) {
      if (!result.ok) console.warn(`[shopify-webhook] registration failed shop=${result.shopDomain} reason=${result.error ?? 'desconhecido'}`)
    }

    return NextResponse.json({ ok, results })
  } catch (error) {
    console.error(`[shopify-webhook] registration failed: ${error instanceof Error ? error.message : 'unexpected error'}`)
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

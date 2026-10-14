import { NextRequest, NextResponse } from 'next/server'
import {
  archiveShopifyOrder,
  resolveShopifyWebhookSecret,
  loadShopifyIntegrationForWebhook,
  upsertShopifyOrder,
} from '@/lib/shopify-confirmation-service'
import { verifyShopifyWebhookHmac } from '@/lib/shopify-client'
import { getShopifyTriggersEnabled } from '@/lib/shopify-trigger-settings'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const topic = req.headers.get('x-shopify-topic') || 'orders/create'

  try {
    console.log(`[shopify-webhook] ${topic} received`)
    const integration = await loadShopifyIntegrationForWebhook(shopDomain)
    if (!integration) {
      console.warn(`[shopify-webhook] ${topic} rejected: integration not found`)
      return NextResponse.json({ ok: false, error: 'Shopify integration not found' }, { status: 404 })
    }

    // App próprio da loja quando configurado, senão o app global.
    const secret = await resolveShopifyWebhookSecret(integration)
    if (!secret) return NextResponse.json({ ok: false, error: 'Client secret not configured' }, { status: 500 })

    if (!verifyShopifyWebhookHmac(rawBody, hmac, secret)) {
      console.warn(`[shopify-webhook] ${topic} rejected: invalid HMAC`)
      return NextResponse.json({ ok: false, error: 'Invalid Shopify HMAC' }, { status: 401 })
    }

    if (topic === 'orders/delete') {
      const archived = await archiveShopifyOrder(integration, JSON.parse(rawBody) as unknown)
      console.log(`[shopify-webhook] orders/delete accepted archived=${Boolean(archived)}`)
      return NextResponse.json({ ok: true, archived: Boolean(archived) })
    }
    const supportedUpsertTopics = new Set(['orders/create', 'orders/updated', 'orders/paid', 'orders/cancelled'])
    if (!supportedUpsertTopics.has(topic)) {
      return NextResponse.json({ ok: false, error: 'Unsupported Shopify topic' }, { status: 400 })
    }

    const payload = JSON.parse(rawBody) as unknown
    const triggersEnabled = await getShopifyTriggersEnabled()
    const order = await upsertShopifyOrder(integration, payload, {
      sendConfirmation: topic === 'orders/create' && triggersEnabled,
    })
    console.log(`[shopify-webhook] ${topic} accepted country=${order.country}`)
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    console.error(`[shopify-webhook] ${topic} failed: ${error instanceof Error ? error.message : 'unexpected error'}`)
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

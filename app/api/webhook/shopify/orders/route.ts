import { NextRequest, NextResponse } from 'next/server'
import {
  decodeShopifyWebhookSecret,
  loadShopifyIntegrationForWebhook,
  upsertShopifyOrder,
} from '@/lib/shopify-confirmation-service'
import { verifyShopifyWebhookHmac } from '@/lib/shopify-client'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const hmac = req.headers.get('x-shopify-hmac-sha256')

  try {
    const integration = await loadShopifyIntegrationForWebhook(shopDomain)
    if (!integration) return NextResponse.json({ ok: false, error: 'Shopify integration not found' }, { status: 404 })

    let secret: string
    if (integration.oauth_connected || !integration.encrypted_webhook_secret) {
      secret = (await getSetting('shopify_client_secret')) ?? process.env.SHOPIFY_CLIENT_SECRET ?? ''
      if (!secret) return NextResponse.json({ ok: false, error: 'Client secret not configured' }, { status: 500 })
    } else {
      secret = decodeShopifyWebhookSecret(integration)
    }

    if (!verifyShopifyWebhookHmac(rawBody, hmac, secret)) {
      return NextResponse.json({ ok: false, error: 'Invalid Shopify HMAC' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody) as unknown
    const order = await upsertShopifyOrder(integration, payload)
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

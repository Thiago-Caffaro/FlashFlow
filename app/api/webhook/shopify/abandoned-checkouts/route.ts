import { NextRequest, NextResponse } from 'next/server'
import {
  resolveShopifyWebhookSecrets,
  loadShopifyIntegrationForWebhook,
  upsertShopifyAbandonedCheckout,
} from '@/lib/shopify-confirmation-service'
import { verifyShopifyWebhookHmac } from '@/lib/shopify-client'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Mesmo prefixo da rota de pedidos, para os dois aparecerem juntos no log.
const log = createLogger('shopify-webhook')

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const topic = req.headers.get('x-shopify-topic') || 'checkouts/create'

  try {
    log.info(`${topic} received`)
    const integration = await loadShopifyIntegrationForWebhook(shopDomain)
    if (!integration) {
      log.warn(`${topic} rejected: integration not found`)
      return NextResponse.json({ ok: false, error: 'Shopify integration not found' }, { status: 404 })
    }

    // App próprio da loja quando configurado, senão o app global.
    // Qualquer app nosso que tenha registrado webhooks nesta loja.
    const secrets = await resolveShopifyWebhookSecrets(integration)
    if (secrets.length === 0) {
      log.error(`${topic} rejected: client secret not configured`)
      return NextResponse.json({ ok: false, error: 'Client secret not configured' }, { status: 500 })
    }

    if (!secrets.some((secret) => verifyShopifyWebhookHmac(rawBody, hmac, secret))) {
      log.warn(`${topic} rejected: invalid HMAC`, { shop: shopDomain, secretsTried: secrets.length })
      return NextResponse.json({ ok: false, error: 'Invalid Shopify HMAC' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody) as unknown
    const checkout = await upsertShopifyAbandonedCheckout(integration, payload) as Record<string, unknown>
    // Sem telefone, nome ou e-mail: só o essencial para saber o que aconteceu.
    log.info(`${topic} accepted`, {
      country: checkout.country,
      phone: checkout.contact_phone ? 'yes' : 'no',
      status: checkout.recovery_status,
      instance: checkout.assigned_instance_name ?? 'none',
    })
    return NextResponse.json({ ok: true, checkout })
  } catch (error) {
    log.error(`${topic} failed`, { error: error instanceof Error ? error.message : 'unexpected error' })
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import {
  loadShopifyIntegrationForWebhook,
  removeShopifyDraftOrder,
  resolveShopifyWebhookSecret,
  upsertShopifyDraftOrder,
} from '@/lib/shopify-confirmation-service'
import { verifyShopifyWebhookHmac } from '@/lib/shopify-client'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Mesmo prefixo das rotas de pedidos e checkouts, para aparecerem juntas no log.
const log = createLogger('shopify-webhook')

const UPSERT_TOPICS = new Set(['draft_orders/create', 'draft_orders/update'])

// Rascunhos (draft orders) — o "carrinho abandonado" das lojas que usam app
// de formulário COD em vez do checkout da Shopify. Ver migration 028.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const topic = req.headers.get('x-shopify-topic') || 'draft_orders/create'

  try {
    log.info(`${topic} received`)
    const integration = await loadShopifyIntegrationForWebhook(shopDomain)
    if (!integration) {
      log.warn(`${topic} rejected: integration not found`)
      return NextResponse.json({ ok: false, error: 'Shopify integration not found' }, { status: 404 })
    }

    const secret = await resolveShopifyWebhookSecret(integration)
    if (!secret) {
      log.error(`${topic} rejected: client secret not configured`)
      return NextResponse.json({ ok: false, error: 'Client secret not configured' }, { status: 500 })
    }
    if (!verifyShopifyWebhookHmac(rawBody, hmac, secret)) {
      log.warn(`${topic} rejected: invalid HMAC`)
      return NextResponse.json({ ok: false, error: 'Invalid Shopify HMAC' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody) as unknown
    if (topic === 'draft_orders/delete') {
      const removed = await removeShopifyDraftOrder(integration, payload)
      log.info(`${topic} accepted`, { known: Boolean(removed) })
      return NextResponse.json({ ok: true, removed: Boolean(removed) })
    }
    if (!UPSERT_TOPICS.has(topic)) {
      log.warn(`${topic} rejected: unsupported topic`)
      return NextResponse.json({ ok: false, error: 'Unsupported Shopify topic' }, { status: 400 })
    }

    const draft = await upsertShopifyDraftOrder(integration, payload) as Record<string, unknown>
    // Sem telefone, nome ou e-mail: só o essencial para saber o que aconteceu.
    log.info(`${topic} accepted`, {
      name: draft.shopify_name ?? 'none',
      country: draft.country,
      phone: draft.contact_phone ? 'yes' : 'no',
      status: draft.recovery_status,
      instance: draft.assigned_instance_name ?? 'none',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    log.error(`${topic} failed`, { error: error instanceof Error ? error.message : 'unexpected error' })
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 500 })
  }
}

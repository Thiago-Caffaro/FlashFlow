import 'server-only'
import { getSetting } from './app-settings'
import { ShopifyClient } from './shopify-client'
import { shopifyClientFromIntegration, type ShopifyIntegrationCredentialRow } from './shopify-integration-store'

const WEBHOOK_SUBSCRIPTIONS = [
  { topic: 'orders/create', path: '/api/webhook/shopify/orders' },
  { topic: 'orders/updated', path: '/api/webhook/shopify/orders' },
  { topic: 'orders/paid', path: '/api/webhook/shopify/orders' },
  { topic: 'orders/cancelled', path: '/api/webhook/shopify/orders' },
  { topic: 'orders/delete', path: '/api/webhook/shopify/orders' },
  // checkouts/update chega a cada passo do cliente no checkout — é ele que
  // empurra o gatilho de carrinho abandonado para frente enquanto o cliente
  // ainda preenche, e que traz completed_at quando o checkout vira pedido.
  { topic: 'checkouts/create', path: '/api/webhook/shopify/abandoned-checkouts' },
  { topic: 'checkouts/update', path: '/api/webhook/shopify/abandoned-checkouts' },
  // Rascunhos de apps de formulário COD (migration 028). Exigem o escopo
  // read_draft_orders — loja conectada antes dele precisa reconectar.
  { topic: 'draft_orders/create', path: '/api/webhook/shopify/draft-orders' },
  { topic: 'draft_orders/update', path: '/api/webhook/shopify/draft-orders' },
  { topic: 'draft_orders/delete', path: '/api/webhook/shopify/draft-orders' },
] as const

export interface WebhookRegistrationResult {
  shopDomain: string
  ok: boolean
  alreadyRegistered: boolean
  error?: string
}

async function resolveWebhookBaseUrl(): Promise<string | null> {
  const appBaseUrl = (await getSetting('shopify_app_base_url')) ?? process.env.APP_BASE_URL ?? ''
  if (!appBaseUrl) return null
  return appBaseUrl.replace(/\/+$/, '')
}

async function ensureForClient(client: ShopifyClient, shopDomain: string): Promise<WebhookRegistrationResult> {
  const baseUrl = await resolveWebhookBaseUrl()
  if (!baseUrl) {
    return {
      shopDomain,
      ok: false,
      alreadyRegistered: false,
      error: 'URL pública do app (shopify_app_base_url / APP_BASE_URL) não configurada',
    }
  }

  // Cada tópico é independente: um tópico recusado (ex: rascunhos sem o
  // escopo read_draft_orders) não impede o registro dos outros.
  let alreadyRegistered = true
  const failures: string[] = []
  for (const { topic, path } of WEBHOOK_SUBSCRIPTIONS) {
    try {
      const address = `${baseUrl}${path}`
      const existing = await client.listWebhooks({ topic })
      const already = (existing.webhooks ?? []).some((webhook) => webhook.address === address)
      if (already) continue
      alreadyRegistered = false
      await client.createWebhook(topic, address)
    } catch (error) {
      failures.push(`${topic}: ${describeRegistrationError(topic, error)}`)
    }
  }
  if (failures.length > 0) {
    return { shopDomain, ok: false, alreadyRegistered: false, error: failures.join('; ') }
  }
  return { shopDomain, ok: true, alreadyRegistered }
}

function describeRegistrationError(topic: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'Erro inesperado'
  if (topic.startsWith('draft_orders/') && /(401|403)|access|scope|permission/i.test(message)) {
    return 'a loja não autorizou rascunhos (escopo read_draft_orders) — adicione o escopo no app e reconecte a loja'
  }
  return message
}

// Registers the order lifecycle (and checkout) subscriptions directly with Shopify via
// the Admin REST API (POST /webhooks.json) so real-time order delivery
// doesn't depend on the merchant manually configuring it under
// Settings → Notifications in the Shopify admin. Safe to call repeatedly —
// it checks for an existing subscription pointing at our address first.
export function ensureOrderCreateWebhookRegistered(
  integration: ShopifyIntegrationCredentialRow
): Promise<WebhookRegistrationResult> {
  return ensureForClient(shopifyClientFromIntegration(integration), integration.shop_domain)
}

// Same as above, but for use right after the OAuth token exchange, before
// the integration row (and its encrypted token) has been written to the DB —
// avoids an unnecessary encrypt-then-immediately-decrypt round trip.
export function ensureOrderCreateWebhookRegisteredWithToken(
  shopDomain: string,
  adminToken: string
): Promise<WebhookRegistrationResult> {
  return ensureForClient(new ShopifyClient({ shopDomain, adminToken }), shopDomain)
}

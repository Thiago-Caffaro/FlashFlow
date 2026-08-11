import 'server-only'
import { getSetting } from './app-settings'
import { ShopifyClient } from './shopify-client'
import { shopifyClientFromIntegration, type ShopifyIntegrationCredentialRow } from './shopify-integration-store'

const ORDER_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/cancelled',
  'orders/delete',
] as const

export interface WebhookRegistrationResult {
  shopDomain: string
  ok: boolean
  alreadyRegistered: boolean
  error?: string
}

async function resolveWebhookAddress(): Promise<string | null> {
  const appBaseUrl = (await getSetting('shopify_app_base_url')) ?? process.env.APP_BASE_URL ?? ''
  if (!appBaseUrl) return null
  return `${appBaseUrl.replace(/\/+$/, '')}/api/webhook/shopify/orders`
}

async function ensureForClient(client: ShopifyClient, shopDomain: string): Promise<WebhookRegistrationResult> {
  const address = await resolveWebhookAddress()
  if (!address) {
    return {
      shopDomain,
      ok: false,
      alreadyRegistered: false,
      error: 'URL pública do app (shopify_app_base_url / APP_BASE_URL) não configurada',
    }
  }

  try {
    let alreadyRegistered = true
    for (const topic of ORDER_TOPICS) {
      const existing = await client.listWebhooks({ topic })
      const already = (existing.webhooks ?? []).some((webhook) => webhook.address === address)
      if (already) continue
      alreadyRegistered = false
      await client.createWebhook(topic, address)
    }
    return { shopDomain, ok: true, alreadyRegistered }
  } catch (error) {
    return { shopDomain, ok: false, alreadyRegistered: false, error: error instanceof Error ? error.message : 'Erro inesperado' }
  }
}

// Registers the order lifecycle subscriptions directly with Shopify via
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

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
    return { shopDomain, ok: false, alreadyRegistered: false, error: summarizeFailures(failures) }
  }
  return { shopDomain, ok: true, alreadyRegistered }
}

// Os três tópicos de rascunho costumam falhar pelo mesmo motivo — vira uma
// linha só em vez de três repetidas.
function summarizeFailures(failures: string[]): string {
  const draftFailures = failures.filter((failure) => failure.startsWith('draft_orders/'))
  const draftReasons = new Set(draftFailures.map((failure) => failure.slice(failure.indexOf(': ') + 2)))
  if (draftFailures.length > 1 && draftReasons.size === 1) {
    const others = failures.filter((failure) => !failure.startsWith('draft_orders/'))
    return [...others, `rascunhos (draft_orders/*): ${[...draftReasons][0]}`].join('; ')
  }
  return failures.join('; ')
}

// Texto de erro que a Shopify devolve no corpo: `errors` pode ser string,
// lista ou objeto { campo: [mensagens] }.
function shopifyErrorDetail(response: unknown): string {
  const errors = (response as { errors?: unknown } | null | undefined)?.errors
  if (typeof errors === 'string') return errors
  if (Array.isArray(errors)) return errors.map(String).join(', ')
  if (errors && typeof errors === 'object') {
    return Object.entries(errors as Record<string, unknown>)
      .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join('; ')
  }
  return ''
}

function describeRegistrationError(topic: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'Erro inesperado'
  // Duck typing em vez de instanceof: ShopifyApiError carrega status e corpo.
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null
  const detail = shopifyErrorDetail((error as { response?: unknown })?.response)
  // A Shopify recusa com 422 (às vezes 401/403) criar webhook de um tópico que
  // o app não tem permissão de ler.
  const deniedByScope = (status !== null && [401, 403, 422].includes(status))
    || /access|scope|permission/i.test(`${message} ${detail}`)
  // Motivo já conhecido: sem o detalhe da Shopify, as três linhas de
  // rascunho ficam idênticas e viram uma só (summarizeFailures).
  if (topic.startsWith('draft_orders/') && deniedByScope) {
    return 'a loja não autorizou rascunhos — adicione o escopo read_draft_orders no app e reconecte a loja'
  }
  const shortDetail = trimShopifyDetail(detail)
  return shortDetail ? `${message}: ${shortDetail}` : message
}

// A Shopify anexa a lista inteira de tópicos permitidos ao erro de tópico
// inválido — corta a partir dela e limita o tamanho.
function trimShopifyDetail(detail: string): string {
  const cut = detail.split(/\s*Topics allowed:/i)[0].trim()
  return cut.length > 200 ? `${cut.slice(0, 200)}…` : cut
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

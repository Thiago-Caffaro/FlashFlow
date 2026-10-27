import 'server-only'
import { decryptSecret } from './ai-crypto'
import { getSetting } from './app-settings'
import { ShopifyClient, normalizeShopDomain } from './shopify-client'
import { supabaseAdmin } from './supabase-admin'

export const SHOPIFY_INTEGRATION_PUBLIC_SELECT =
  'id, shop_name, shop_domain, default_country, active, oauth_connected, confirmation_message_template, recovery_message_template, recovery_template_id, recovery_template_variable_map, app_client_id, created_at, updated_at'

export type ShopifyIntegrationCredentialRow = {
  id: string
  shop_name: string
  shop_domain: string
  encrypted_admin_token: string
  admin_token_iv: string
  admin_token_auth_tag: string
  encrypted_webhook_secret: string | null
  webhook_secret_iv: string | null
  webhook_secret_auth_tag: string | null
  default_country: string
  active: boolean
  oauth_connected: boolean
  confirmation_message_template: string | null
  recovery_message_template: string | null
  recovery_template_id: string | null
  recovery_template_variable_map: Record<string, string> | null
  // App próprio da loja (migration 026). Vazio = app global.
  app_client_id?: string | null
  encrypted_app_client_secret?: string | null
  app_client_secret_iv?: string | null
  app_client_secret_auth_tag?: string | null
}

export type ShopifyAppCredentialFields = Pick<
  ShopifyIntegrationCredentialRow,
  'app_client_id' | 'encrypted_app_client_secret' | 'app_client_secret_iv' | 'app_client_secret_auth_tag'
>

export interface ShopifyAppCredentials {
  clientId: string
  clientSecret: string
  // true quando vêm do app próprio da loja, false quando do app global.
  perStore: boolean
}

export function hasOwnShopifyApp(row: ShopifyAppCredentialFields | null | undefined): boolean {
  return Boolean(
    row?.app_client_id
    && row.encrypted_app_client_secret
    && row.app_client_secret_iv
    && row.app_client_secret_auth_tag
  )
}

// Credenciais do app Shopify de uma loja: o app próprio dela quando
// configurado, senão o app global (app_settings, depois env).
export async function getShopifyAppCredentials(
  row?: ShopifyAppCredentialFields | null
): Promise<ShopifyAppCredentials> {
  if (row && hasOwnShopifyApp(row)) {
    return {
      clientId: row.app_client_id!,
      clientSecret: decryptSecret(row.encrypted_app_client_secret!, row.app_client_secret_iv!, row.app_client_secret_auth_tag!),
      perStore: true,
    }
  }
  const [clientIdDb, clientSecretDb] = await Promise.all([
    getSetting('shopify_client_id'),
    getSetting('shopify_client_secret'),
  ])
  return {
    clientId: clientIdDb ?? process.env.SHOPIFY_CLIENT_ID ?? '',
    clientSecret: clientSecretDb ?? process.env.SHOPIFY_CLIENT_SECRET ?? '',
    perStore: false,
  }
}

// Chave que assina os webhooks da loja. Webhooks registrados pela API do app
// (lojas OAuth) são assinados com o Client Secret desse app; lojas antigas
// configuradas à mão guardam o segredo de webhook próprio.
export async function resolveShopifyWebhookSecret(row: ShopifyIntegrationCredentialRow): Promise<string> {
  if (row.oauth_connected || !row.encrypted_webhook_secret) {
    return (await getShopifyAppCredentials(row)).clientSecret
  }
  return decodeShopifyWebhookSecret(row)
}

// Todas as chaves que podem ter assinado um webhook desta loja. Uma loja que
// foi conectada pelo app global e depois pelo app próprio (ou o contrário)
// continua com webhooks registrados pelos dois apps na Shopify, cada um
// assinado com o segredo do app que o criou. A primeira é a preferida.
export async function resolveShopifyWebhookSecrets(row: ShopifyIntegrationCredentialRow): Promise<string[]> {
  const candidates: string[] = []
  try {
    candidates.push(await resolveShopifyWebhookSecret(row))
  } catch {
    // Segredo legado ilegível: segue com os segredos dos apps.
  }
  if (hasOwnShopifyApp(row)) candidates.push((await getShopifyAppCredentials(null)).clientSecret)
  if (row.encrypted_webhook_secret && row.webhook_secret_iv && row.webhook_secret_auth_tag) {
    try {
      candidates.push(decryptSecret(row.encrypted_webhook_secret, row.webhook_secret_iv, row.webhook_secret_auth_tag))
    } catch {
      // ignora
    }
  }
  return [...new Set(candidates.filter(Boolean))]
}

export function decodeShopifyAdminToken(row: ShopifyIntegrationCredentialRow): string {
  return decryptSecret(row.encrypted_admin_token, row.admin_token_iv, row.admin_token_auth_tag)
}

export function decodeShopifyWebhookSecret(row: ShopifyIntegrationCredentialRow): string {
  if (row.oauth_connected || !row.encrypted_webhook_secret) {
    const secret = process.env.SHOPIFY_CLIENT_SECRET
    if (!secret) throw new Error('SHOPIFY_CLIENT_SECRET not configured — add it in Settings → Shopify or set the env var')
    return secret
  }
  return decryptSecret(row.encrypted_webhook_secret, row.webhook_secret_iv!, row.webhook_secret_auth_tag!)
}

export function shopifyClientFromIntegration(row: ShopifyIntegrationCredentialRow): ShopifyClient {
  return new ShopifyClient({
    shopDomain: row.shop_domain,
    adminToken: decodeShopifyAdminToken(row),
  })
}

export async function loadShopifyIntegrationForWebhook(shopDomain: string): Promise<ShopifyIntegrationCredentialRow | null> {
  const normalizedDomain = normalizeShopDomain(shopDomain)
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('*')
    .eq('shop_domain', normalizedDomain)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar integração Shopify: ${error.message}`)
  return data as ShopifyIntegrationCredentialRow | null
}

export async function listActiveShopifyIntegrations(id?: string): Promise<ShopifyIntegrationCredentialRow[]> {
  let query = supabaseAdmin
    .from('shopify_integrations')
    .select('*')
    .eq('active', true)
    .order('shop_domain')
  if (id) query = query.eq('id', id)
  const { data, error } = await query
  if (error) throw new Error(`Falha ao listar integrações Shopify: ${error.message}`)
  return (data ?? []) as ShopifyIntegrationCredentialRow[]
}

// Credenciais do app próprio já salvas para um domínio (ativo ou não) —
// usadas para reconectar uma loja sem pedir o Client Secret de novo.
export async function loadShopifyAppFieldsByDomain(shopDomain: string): Promise<ShopifyAppCredentialFields | null> {
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('app_client_id, encrypted_app_client_secret, app_client_secret_iv, app_client_secret_auth_tag')
    .eq('shop_domain', normalizeShopDomain(shopDomain))
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar integração Shopify: ${error.message}`)
  return (data as ShopifyAppCredentialFields | null) ?? null
}

import 'server-only'
import { decryptSecret } from './ai-crypto'
import { ShopifyClient, normalizeShopDomain } from './shopify-client'
import { supabaseAdmin } from './supabase-admin'

export const SHOPIFY_INTEGRATION_PUBLIC_SELECT =
  'id, shop_name, shop_domain, default_country, active, oauth_connected, confirmation_message_template, recovery_message_template, created_at, updated_at'

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

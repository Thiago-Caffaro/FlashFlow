import 'server-only'
import { encryptSecret } from './ai-crypto'
import { getSetting } from './app-settings'
import { LIGHTFUNNELS_DEFAULT_SCOPES } from './lightfunnels-client'
import { supabaseAdmin } from './supabase-admin'

export const LIGHTFUNNELS_INTEGRATION_PUBLIC_SELECT =
  'id, name, lf_account_id, scopes, default_country, active, oauth_connected, writeback_enabled, access_token_expires_at, last_webhook_at, last_error, created_at, updated_at'

export const LIGHTFUNNELS_SETTING_KEYS = {
  clientId: 'lightfunnels_client_id',
  clientSecret: 'lightfunnels_client_secret',
  scopes: 'lightfunnels_scopes',
} as const

export type LightfunnelsIntegrationCredentialRow = {
  id: string
  name: string
  lf_account_id: string
  encrypted_access_token: string
  access_token_iv: string
  access_token_auth_tag: string
  access_token_expires_at: string
  encrypted_refresh_token: string
  refresh_token_iv: string
  refresh_token_auth_tag: string
  scopes: string
  default_country: string
  active: boolean
  oauth_connected: boolean
  writeback_enabled: boolean
  webhook_ids: Record<string, string> | null
  last_webhook_at: string | null
  last_error: string | null
}

export interface LightfunnelsAppCredentials {
  clientId: string
  clientSecret: string
  scopes: string
}

// Um único app de Partners serve todas as contas Lightfunnels — diferente da
// Shopify, não há app por loja.
export async function getLightfunnelsAppCredentials(): Promise<LightfunnelsAppCredentials> {
  const [clientId, clientSecret, scopes] = await Promise.all([
    getSetting(LIGHTFUNNELS_SETTING_KEYS.clientId),
    getSetting(LIGHTFUNNELS_SETTING_KEYS.clientSecret),
    getSetting(LIGHTFUNNELS_SETTING_KEYS.scopes),
  ])
  return {
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    scopes: scopes ?? LIGHTFUNNELS_DEFAULT_SCOPES,
  }
}

// Base pública para OAuth e webhooks — a mesma da Shopify (um só app Next).
export async function getLightfunnelsAppBaseUrl(): Promise<string> {
  const stored = await getSetting('shopify_app_base_url')
  return (stored ?? process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
}

export function encryptedTokenColumns(accessToken: string, refreshToken: string, expiresInSeconds: number) {
  const access = encryptSecret(accessToken)
  const refresh = encryptSecret(refreshToken)
  // Margem de 60s sobre o expires_in (7199s) para nunca usar um token no
  // limite da validade.
  const expiresAt = new Date(Date.now() + Math.max(60, expiresInSeconds - 60) * 1000).toISOString()
  return {
    encrypted_access_token: access.encrypted_key,
    access_token_iv: access.iv,
    access_token_auth_tag: access.auth_tag,
    access_token_expires_at: expiresAt,
    encrypted_refresh_token: refresh.encrypted_key,
    refresh_token_iv: refresh.iv,
    refresh_token_auth_tag: refresh.auth_tag,
  }
}

export async function loadLightfunnelsIntegration(id: string): Promise<LightfunnelsIntegrationCredentialRow | null> {
  const { data, error } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar integração Lightfunnels: ${error.message}`)
  return data as LightfunnelsIntegrationCredentialRow | null
}

export async function listActiveLightfunnelsIntegrations(id?: string): Promise<LightfunnelsIntegrationCredentialRow[]> {
  let query = supabaseAdmin
    .from('lightfunnels_integrations')
    .select('*')
    .eq('active', true)
    .order('name')
  if (id) query = query.eq('id', id)
  const { data, error } = await query
  if (error) throw new Error(`Falha ao listar integrações Lightfunnels: ${error.message}`)
  return (data ?? []) as LightfunnelsIntegrationCredentialRow[]
}

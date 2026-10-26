import 'server-only'
import { decryptSecret } from './ai-crypto'
import { LightfunnelsClient, LIGHTFUNNELS_TOKEN_URL } from './lightfunnels-client'
import {
  encryptedTokenColumns,
  getLightfunnelsAppCredentials,
  loadLightfunnelsIntegration,
  type LightfunnelsIntegrationCredentialRow,
} from './lightfunnels-integration-store'
import { supabaseAdmin } from './supabase-admin'

// Access token do Lightfunnels dura 2h; o refresh token é rotativo — cada
// refresh devolve um novo e invalida o anterior. Se duas requisições
// renovarem ao mesmo tempo, só a primeira consegue usar o refresh token; a
// segunda recebe invalid_grant. Por isso o UPDATE é condicionado ao
// refresh_token_iv lido (lock otimista) e, quando perde a corrida, relê a
// linha e usa o token que a outra gravou.

const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface LightfunnelsTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export class LightfunnelsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LightfunnelsAuthError'
  }
}

export async function requestLightfunnelsToken(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<LightfunnelsTokenResponse> {
  const res = await fetchImpl(LIGHTFUNNELS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    cache: 'no-store',
  })
  const text = await res.text()
  let json: Partial<LightfunnelsTokenResponse> & { error?: string; error_description?: string } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    // corpo não-JSON: cai no erro abaixo
  }
  if (!res.ok || !json.access_token || !json.refresh_token) {
    const reason = json.error_description || json.error || text.slice(0, 200) || `HTTP ${res.status}`
    throw new LightfunnelsAuthError(`Lightfunnels recusou o token: ${reason}`)
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: Number(json.expires_in ?? 7199),
  }
}

function decodeAccessToken(row: LightfunnelsIntegrationCredentialRow): string {
  return decryptSecret(row.encrypted_access_token, row.access_token_iv, row.access_token_auth_tag)
}

function isFresh(row: LightfunnelsIntegrationCredentialRow): boolean {
  return new Date(row.access_token_expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS
}

async function markDisconnected(integrationId: string, message: string) {
  await supabaseAdmin
    .from('lightfunnels_integrations')
    .update({ oauth_connected: false, last_error: message, updated_at: new Date().toISOString() })
    .eq('id', integrationId)
}

export async function getValidAccessToken(
  integration: LightfunnelsIntegrationCredentialRow | string
): Promise<string> {
  const row = typeof integration === 'string' ? await loadLightfunnelsIntegration(integration) : integration
  if (!row) throw new Error('Integração Lightfunnels não encontrada')
  if (!row.oauth_connected) throw new LightfunnelsAuthError('Conta Lightfunnels desconectada — reconecte em Fulfillment → Lightfunnels')
  if (isFresh(row)) return decodeAccessToken(row)

  const app = await getLightfunnelsAppCredentials()
  if (!app.clientId || !app.clientSecret) throw new Error('Credenciais do app Lightfunnels não configuradas')

  let tokens: LightfunnelsTokenResponse
  try {
    tokens = await requestLightfunnelsToken({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(row.encrypted_refresh_token, row.refresh_token_iv, row.refresh_token_auth_tag),
      client_id: app.clientId,
      client_secret: app.clientSecret,
    })
  } catch (error) {
    // Outra requisição pode ter renovado primeiro e invalidado o nosso
    // refresh token — nesse caso a linha já tem um token novo.
    const latest = await loadLightfunnelsIntegration(row.id)
    if (latest && latest.refresh_token_iv !== row.refresh_token_iv && isFresh(latest)) {
      return decodeAccessToken(latest)
    }
    const message = error instanceof Error ? error.message : 'Falha ao renovar token Lightfunnels'
    if (error instanceof LightfunnelsAuthError) await markDisconnected(row.id, message)
    throw error
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .update({
      ...encryptedTokenColumns(tokens.access_token, tokens.refresh_token, tokens.expires_in),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('refresh_token_iv', row.refresh_token_iv)
    .select('id')
    .maybeSingle()
  if (updateError) throw new Error(`Falha ao gravar token Lightfunnels renovado: ${updateError.message}`)
  // !updated = outra requisição gravou antes de nós. O access token que
  // obtivemos continua válido por 2h; o refresh token salvo fica o dela.
  if (!updated) console.warn(`[lightfunnels-token] refresh concorrente na integração ${row.id}`)
  return tokens.access_token
}

export async function lightfunnelsClientFor(
  integration: LightfunnelsIntegrationCredentialRow | string
): Promise<LightfunnelsClient> {
  return new LightfunnelsClient(await getValidAccessToken(integration))
}

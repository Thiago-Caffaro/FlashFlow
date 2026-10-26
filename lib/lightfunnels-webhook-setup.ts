import 'server-only'
import { getLightfunnelsAppBaseUrl, type LightfunnelsIntegrationCredentialRow } from './lightfunnels-integration-store'
import { lightfunnelsClientFor } from './lightfunnels-token'
import { supabaseAdmin } from './supabase-admin'

export const LIGHTFUNNELS_WEBHOOK_PATH = '/api/webhook/lightfunnels'

// order/created dispara antes dos upsells/downsells terminarem (o pedido
// pode chegar sem todos os itens) — o pedido entra no FlashFlow em
// order/confirmed, que já vem completo.
export const LIGHTFUNNELS_WEBHOOK_EVENTS = [
  'order/confirmed',
  'order/updated',
  'order/cancelled',
  'order/uncancelled',
  'order/refunded',
  'order/fulfilled',
  'payment/paid',
  'product/created',
  'product/updated',
  'product/deleted',
  'app/uninstalled',
] as const

export type LightfunnelsWebhookEvent = typeof LIGHTFUNNELS_WEBHOOK_EVENTS[number]

export function isLightfunnelsWebhookEvent(value: unknown): value is LightfunnelsWebhookEvent {
  return typeof value === 'string' && (LIGHTFUNNELS_WEBHOOK_EVENTS as readonly string[]).includes(value)
}

// O payload do Lightfunnels não diz qual evento é (só traz `node`), e o
// proxy.ts libera apenas caminhos exatos — integração e evento vão na query.
export function lightfunnelsWebhookUrl(baseUrl: string, integrationId: string, event: string): string {
  const params = new URLSearchParams({ integration: integrationId, event })
  return `${baseUrl}${LIGHTFUNNELS_WEBHOOK_PATH}?${params.toString()}`
}

export interface LightfunnelsWebhookRegistrationResult {
  integrationId: string
  ok: boolean
  created: number
  error?: string
}

// A API documenta createWebhook/deleteWebhook, mas não uma listagem — os
// IDs criados ficam em lightfunnels_integrations.webhook_ids e evento já
// registrado é pulado. `force` apaga os registrados e cria de novo (ex:
// mudou a URL pública do app).
export async function ensureLightfunnelsWebhooks(
  integration: LightfunnelsIntegrationCredentialRow,
  options: { force?: boolean } = {}
): Promise<LightfunnelsWebhookRegistrationResult> {
  const baseUrl = await getLightfunnelsAppBaseUrl()
  if (!baseUrl) {
    return { integrationId: integration.id, ok: false, created: 0, error: 'URL pública do app (APP_BASE_URL) não configurada' }
  }

  const registered: Record<string, string> = { ...(integration.webhook_ids ?? {}) }
  let created = 0
  let failure: string | undefined
  try {
    const client = await lightfunnelsClientFor(integration)
    if (options.force) {
      for (const [event, id] of Object.entries(registered)) {
        try {
          await client.deleteWebhook(id)
        } catch (error) {
          // Webhook já apagado no Lightfunnels: segue e recria.
          console.warn(`[lightfunnels-webhook] delete ${event} falhou: ${error instanceof Error ? error.message : error}`)
        }
        delete registered[event]
      }
    }
    for (const event of LIGHTFUNNELS_WEBHOOK_EVENTS) {
      if (registered[event]) continue
      registered[event] = await client.createWebhook({
        type: event,
        url: lightfunnelsWebhookUrl(baseUrl, integration.id, event),
      })
      created += 1
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Erro inesperado'
  }

  // Grava inclusive em falha parcial, para não recriar duplicado o que já foi.
  const { error: saveError } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .update({ webhook_ids: registered, updated_at: new Date().toISOString() })
    .eq('id', integration.id)
  if (saveError && !failure) failure = `Webhooks criados, mas não salvos: ${saveError.message}`

  return failure
    ? { integrationId: integration.id, ok: false, created, error: failure }
    : { integrationId: integration.id, ok: true, created }
}

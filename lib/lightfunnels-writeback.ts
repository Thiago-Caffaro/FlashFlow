import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { loadLightfunnelsIntegration } from './lightfunnels-integration-store'
import { lightfunnelsClientFor } from './lightfunnels-token'
import { createLogger } from './logger'

const log = createLogger('lightfunnels-writeback')

// Escrita de volta no Lightfunnels: tags `ff:*` no pedido refletindo o que
// aconteceu no FlashFlow (confirmação comercial, envio ao FenixCOD,
// entrega). Opt-in por integração (writeback_enabled, desligado por padrão).
//
// É idempotente: as tags desejadas são calculadas do estado atual do pedido
// e só há chamada à API quando mudam (lightfunnels_writeback_tags guarda o
// último conjunto gravado). Tags que não são `ff:` (do lojista) são
// preservadas. Falha não afeta o fluxo do pedido — vai para
// lightfunnels_writeback_error e é refeita na próxima mudança de estado.

export const WRITEBACK_TAG_PREFIX = 'ff:'

interface WritebackOrderRow {
  id: string
  source: string | null
  lightfunnels_integration_id: string | null
  lightfunnels_order_id: string | null
  lead_number: string | null
  commercial_status: string | null
  delivery_status: string | null
  is_simulation: boolean | null
  raw_lightfunnels_payload: Record<string, unknown> | null
  lightfunnels_writeback_tags: string[] | null
}

const DELIVERY_TAGS: Record<string, string> = {
  'A caminho': 'ff:a-caminho',
  Novidade: 'ff:novidade',
  Rejeitado: 'ff:rejeitado',
  Entregue: 'ff:entregue',
}

export function desiredWritebackTags(order: Pick<WritebackOrderRow, 'commercial_status' | 'lead_number' | 'delivery_status'>): string[] {
  const tags: string[] = []
  const commercial = String(order.commercial_status ?? '')
  if (commercial.startsWith('Confirmado')) tags.push('ff:confirmado')
  else if (commercial === 'Desistiu') tags.push('ff:desistiu')
  if (order.lead_number) tags.push('ff:enviado-fenixcod')
  const deliveryTag = DELIVERY_TAGS[String(order.delivery_status ?? '')]
  if (deliveryTag) tags.push(deliveryTag)
  return tags
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

export function mergeWritebackTags(merchantTags: unknown, desired: string[]): string[] {
  const kept = (Array.isArray(merchantTags) ? merchantTags : [])
    .map((tag) => String(tag ?? '').trim())
    .filter((tag) => tag && !tag.startsWith(WRITEBACK_TAG_PREFIX))
  return [...new Set([...kept, ...desired])]
}

export async function syncLightfunnelsOrderTags(orderId: string): Promise<'skipped' | 'unchanged' | 'updated'> {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, source, lightfunnels_integration_id, lightfunnels_order_id, lead_number, commercial_status, delivery_status, is_simulation, raw_lightfunnels_payload, lightfunnels_writeback_tags')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar pedido para write-back: ${error.message}`)
  const order = data as WritebackOrderRow | null
  if (!order || order.source !== 'lightfunnels' || order.is_simulation) return 'skipped'
  if (!order.lightfunnels_integration_id || !order.lightfunnels_order_id) return 'skipped'

  const integration = await loadLightfunnelsIntegration(order.lightfunnels_integration_id)
  if (!integration?.active || !integration.writeback_enabled || !integration.oauth_connected) return 'skipped'

  const desired = desiredWritebackTags(order)
  if (sameTags(desired, order.lightfunnels_writeback_tags ?? [])) return 'unchanged'

  try {
    const client = await lightfunnelsClientFor(integration)
    // Tags atuais do lojista vêm da API (o payload salvo pode estar velho).
    const current = await client.getOrder(order.lightfunnels_order_id)
    const merchantTags = current?.tags ?? order.raw_lightfunnels_payload?.tags
    await client.updateOrderTags(order.lightfunnels_order_id, { tags: mergeWritebackTags(merchantTags, desired) })
    await supabaseAdmin
      .from('fulfillment_orders')
      .update({ lightfunnels_writeback_tags: desired, lightfunnels_writeback_error: null })
      .eq('id', order.id)
    return 'updated'
  } catch (writebackError) {
    const message = writebackError instanceof Error ? writebackError.message : 'Falha no write-back Lightfunnels'
    await supabaseAdmin
      .from('fulfillment_orders')
      .update({ lightfunnels_writeback_error: message.slice(0, 500) })
      .eq('id', order.id)
    throw writebackError
  }
}

// Disparo sem bloquear quem mudou o estado do pedido. Só para pedidos
// Lightfunnels — quem chama já sabe a origem, então pedidos Shopify/manuais
// não custam nenhuma consulta extra.
export function scheduleLightfunnelsWriteback(order: { id?: unknown; source?: unknown } | null | undefined): void {
  if (!order || order.source !== 'lightfunnels' || typeof order.id !== 'string') return
  const orderId = order.id
  void syncLightfunnelsOrderTags(orderId).catch((error) => {
    log.warn('write-back failed', { orderId, error }, { throttleKey: orderId })
  })
}

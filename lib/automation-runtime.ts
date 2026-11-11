import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { enqueueDeliveryStatusAutomationJob } from './flow-jobs'
import { resolveCatalogProductLine, resolveShopifyCartProductLine } from './product-lines'
import { extractLightfunnelsOrderProductIds, extractShopifyProductIds } from './product-line-match'
import { messageMatchesKeywords, pickCartAutomation, pickScopedAutomation } from './automation-rules'
import type { Automation, AutomationKind, AutomationStep, AutomationWithSteps, CatalogPlatform } from '@/types'

// Execução das automações simples nos eventos do sistema (carrinho
// abandonado, pedido criado, status de entrega, mensagem recebida).
// Separado de lib/automations.ts, que é o CRUD do painel.

export type CartAutomationMatch = {
  automation: AutomationWithSteps
  productLineId: string | null
}

export type OrderAutomationMatch = CartAutomationMatch & { step: AutomationStep & { flow_id: string } }

async function loadEnabledAutomations(kind: AutomationKind, filters: { platform?: CatalogPlatform; instanceName?: string } = {}) {
  let query = supabaseAdmin
    .from('automations')
    .select('*')
    .eq('kind', kind)
    .eq('enabled', true)
  if (filters.platform) query = query.eq('platform', filters.platform)
  if (filters.instanceName) query = query.eq('instance_name', filters.instanceName)
  const { data, error } = await query.order('created_at')
  if (error) throw new Error(`Falha ao consultar automações: ${error.message}`)
  return (data ?? []) as Automation[]
}

// Lembretes com fluxo gerado, em ordem.
async function loadStepsWithFlow(automation: Automation): Promise<AutomationWithSteps> {
  const { data: steps, error } = await supabaseAdmin
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automation.id)
    .order('position')
  if (error) throw new Error(`Falha ao consultar lembretes da automação: ${error.message}`)
  return { ...automation, steps: ((steps ?? []) as AutomationStep[]).filter((step) => Boolean(step.flow_id)) }
}

function firstStep(automation: AutomationWithSteps): (AutomationStep & { flow_id: string }) | null {
  const step = automation.steps[0]
  return step?.flow_id ? step as AutomationStep & { flow_id: string } : null
}

// Automação ligada que atende este carrinho Shopify (país + linha dos
// produtos vinculados), com os lembretes que já têm fluxo gerado.
export async function findShopifyCartAutomation(input: {
  integrationId: string
  country: string | null
  payload: unknown
}): Promise<CartAutomationMatch | null> {
  const automations = await loadEnabledAutomations('abandoned_cart', { platform: 'shopify' })
  if (automations.length === 0) return null

  // Só resolve a linha (3 consultas) quando há automação ligada.
  const line = await resolveShopifyCartProductLine(input.integrationId, input.payload)
  const productLineId = line?.id ?? null
  const automation = pickCartAutomation(automations, { platform: 'shopify', country: input.country, productLineId })
  if (!automation) return null
  return { automation: await loadStepsWithFlow(automation), productLineId }
}

// O que uma automação de pedido precisa do pedido gravado.
export interface OrderAutomationScope {
  is_simulation?: boolean | null
  source?: string | null
  country?: string | null
  shopify_integration_id?: string | null
  lightfunnels_integration_id?: string | null
  raw_shopify_payload?: unknown
  items?: unknown
}

const ORDER_SCOPE_SELECT = 'id, is_simulation, source, country, shopify_integration_id, lightfunnels_integration_id, raw_shopify_payload, items'

export async function loadOrderAutomationScope(orderId: string): Promise<OrderAutomationScope | null> {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select(ORDER_SCOPE_SELECT)
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar pedido da automação: ${error.message}`)
  return (data ?? null) as OrderAutomationScope | null
}

async function resolveOrderProductLineId(platform: CatalogPlatform, order: OrderAutomationScope): Promise<string | null> {
  if (platform === 'shopify') {
    if (!order.shopify_integration_id) return null
    const line = await resolveCatalogProductLine('shopify', order.shopify_integration_id, extractShopifyProductIds(order.raw_shopify_payload))
    return line?.id ?? null
  }
  if (!order.lightfunnels_integration_id) return null
  const line = await resolveCatalogProductLine('lightfunnels', order.lightfunnels_integration_id, extractLightfunnelsOrderProductIds(order.items))
  return line?.id ?? null
}

// Automação ligada de pedido criado / status de entrega que atende este
// pedido (plataforma, país, linha e, na entrega, o novo status). Pedido
// manual não tem plataforma de loja e nunca casa.
export async function findOrderAutomation(
  kind: 'order_created' | 'delivery_status',
  order: OrderAutomationScope,
  deliveryStatus?: string
): Promise<OrderAutomationMatch | null> {
  const platform = order.source === 'shopify' || order.source === 'lightfunnels' ? order.source : null
  if (!platform) return null
  const automations = await loadEnabledAutomations(kind, { platform })
  if (automations.length === 0) return null

  const productLineId = await resolveOrderProductLineId(platform, order)
  const automation = pickScopedAutomation(automations, {
    kind,
    platform,
    country: order.country ?? null,
    productLineId,
    deliveryStatus,
  })
  if (!automation) return null
  const withSteps = await loadStepsWithFlow(automation)
  const step = firstStep(withSteps)
  return step ? { automation: withSteps, productLineId, step } : null
}

// Mudança de status de entrega já aplicada (evento `eventId`): enfileira o
// envio da automação que atende o pedido e cancela os jobs dos gatilhos da
// conta para o mesmo evento. false = nenhuma automação.
export async function scheduleDeliveryStatusAutomation(orderId: string, eventId: string, deliveryStatus: string): Promise<boolean> {
  const order = await loadOrderAutomationScope(orderId)
  if (!order || order.is_simulation) return false
  const match = await findOrderAutomation('delivery_status', order, deliveryStatus)
  if (!match) return false
  await enqueueDeliveryStatusAutomationJob({
    orderId,
    eventId,
    automationId: match.automation.id,
    instanceName: match.automation.instance_name,
    flowId: match.step.flow_id,
    deliveryStatus,
  })
  return true
}

// Resposta por palavra-chave do número: a primeira automação ligada (por
// criação) cuja palavra aparece na mensagem.
export async function findMessageAutomation(
  instanceName: string,
  message: string
): Promise<{ automation: AutomationWithSteps; step: AutomationStep & { flow_id: string } } | null> {
  const automations = await loadEnabledAutomations('message_keyword', { instanceName })
  const automation = automations.find((candidate) => messageMatchesKeywords(candidate.config, message))
  if (!automation) return null
  const withSteps = await loadStepsWithFlow(automation)
  const step = firstStep(withSteps)
  return step ? { automation: withSteps, step } : null
}

// Número pelo qual o lembrete sai, lido na hora do envio: desligar a
// automação para os lembretes pendentes, e trocar o número leva os pendentes
// para o número novo. null = automação desligada ou apagada.
export async function getEnabledAutomationInstance(automationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('automations')
    .select('instance_name, enabled')
    .eq('id', automationId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar automação: ${error.message}`)
  if (!data || data.enabled !== true) return null
  return String(data.instance_name)
}

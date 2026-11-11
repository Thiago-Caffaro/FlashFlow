import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { normalizePhone } from './phone'
import { ISO_TO_FULFILLMENT_COUNTRY } from './fulfillment-countries'
import { recordOrderEvent } from './fulfillment-service'
import { enqueueLightfunnelsOrderFlowJob } from './flow-jobs'
import { findOrderAutomation } from './automation-runtime'
import { assignConfirmationAccount } from './order-account-routing'
import { calculatePhysicalUnitPrice, resolvePackQuantity, type PackQuantitySource } from './shopify-pack-quantity'
import type { LightfunnelsIntegrationCredentialRow } from './lightfunnels-integration-store'
import { createLogger } from './logger'

const log = createLogger('lightfunnels-order')

// Pedido Lightfunnels → fulfillment_orders. Mesmo ciclo do pedido Shopify
// (lib/shopify-confirmation-service.ts): entra como pending_operator, a
// conta WhatsApp é escolhida por assignConfirmationAccount (vínculos da
// conta LF, com filtro de funil) e o gatilho "Pedido Lightfunnels criado"
// da conta roda o fluxo de confirmação. O FenixCOD só recebe depois da
// confirmação comercial, como hoje.

type LightfunnelsOrderItem = {
  product_id: string
  lightfunnels_product_id?: string
  lightfunnels_variant_id?: string
  lightfunnels_quantity: number
  units_per_pack: number
  pack_quantity_source: PackQuantitySource
  sku: string
  name: string
  quantity: number
  unit_price: number
  total: number
}

export type LightfunnelsOrderMappedFields = {
  source: 'lightfunnels'
  // null só em pedido simulado do Sandbox sem conta Lightfunnels conectada.
  lightfunnels_integration_id: string | null
  lightfunnels_order_id: string
  lightfunnels_order_name: string | null
  lightfunnels_funnel_id: string | null
  lightfunnels_store_id: string | null
  lightfunnels_financial_status: string | null
  lightfunnels_fulfillment_status: string | null
  lightfunnels_cancelled_at: string | null
  lightfunnels_archived_at: string | null
  raw_lightfunnels_payload: Record<string, unknown>
  order_placed_at: string
  order_number: string
  instance_name: string
  assigned_instance_name: string | null
  country: string
  contact_phone: string
  customer_name: string
  email: string | null
  address: string
  city: string
  province: string
  zipcode: string
  payment_type: 'COD' | 'PREPAID'
  items: LightfunnelsOrderItem[]
  total: number
  currency: string
}

interface IntegrationContext {
  id: string | null
  lfAccountId: string
  defaultCountry: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// Endereços podem vir como objeto ou lista (Customer.shipping_address é [Address]).
function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value)
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function nullableString(...values: unknown[]): string | null {
  return stringValue(...values) || null
}

function nullableDateString(value: unknown): string | null {
  const raw = nullableString(value)
  if (!raw) return null
  const timestamp = new Date(raw)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : fallback
}

// O Lightfunnels pode mandar o país como ISO ("ES") ou nome ("Spain"). Os
// nomes em inglês já batem com os do FenixCOD na maioria dos casos
// (SPAIN, PORTUGAL, FRANCE...).
export function normalizeLightfunnelsCountry(value: unknown, fallback: string): string {
  const upper = stringValue(value, fallback).toUpperCase()
  return ISO_TO_FULFILLMENT_COUNTRY[upper] ?? upper
}

// Webhook manda { node: {...} }; a API (node(id)) devolve o objeto direto.
export function unwrapLightfunnelsNode(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload)
  return record.node && typeof record.node === 'object' ? asRecord(record.node) : record
}

export function lightfunnelsOrderCountry(order: Record<string, unknown>, fallback: string): string {
  const shipping = asRecord(order.shipping_address)
  const billing = asRecord(order.billing_address)
  return normalizeLightfunnelsCountry(shipping.country ?? billing.country, fallback)
}

// Itens chegam como snapshots (VariantSnapshot / OrderBumpSnapshot), sem
// campo de quantidade documentado: cada snapshot é uma unidade vendida.
// Agrupamos por variante+preço; snapshots removidos (removed_at) não contam.
export function mapLightfunnelsItems(value: unknown): LightfunnelsOrderItem[] {
  const groups = new Map<string, { raw: Record<string, unknown>; count: number; price: number }>()
  const entries = Array.isArray(value) ? value : []
  entries.forEach((entry, index) => {
    const item = asRecord(entry)
    if (item.removed_at) return
    const price = Math.max(0, numberValue(item.price, 0))
    const explicitQuantity = Math.trunc(numberValue(item.quantity, 1))
    if (explicitQuantity <= 0) return
    const key = [
      stringValue(item.variant_id, item.product_id, item.sku, `idx-${index}`),
      price,
    ].join('|')
    const group = groups.get(key)
    if (group) group.count += explicitQuantity
    else groups.set(key, { raw: item, count: explicitQuantity, price })
  })

  return [...groups.values()].map(({ raw, count, price }, index) => {
    const pack = resolvePackQuantity({ rawSku: raw.sku, titles: [raw.title] })
    const quantity = count * pack.unitsPerPack
    const total = price * count
    const variantId = stringValue(raw.variant_id)
    const productId = stringValue(raw.product_id)
    return {
      product_id: stringValue(variantId, productId, `LIGHTFUNNELS-${index + 1}`),
      lightfunnels_product_id: productId || undefined,
      lightfunnels_variant_id: variantId || undefined,
      lightfunnels_quantity: count,
      units_per_pack: pack.unitsPerPack,
      pack_quantity_source: pack.source,
      sku: pack.sku,
      name: stringValue(raw.title, pack.sku, `Produto Lightfunnels ${index + 1}`),
      quantity,
      unit_price: calculatePhysicalUnitPrice(total, quantity),
      total,
    }
  })
}

export function mapLightfunnelsOrderPayload(
  payload: unknown,
  integration: IntegrationContext,
  assignedInstanceName: string | null
): LightfunnelsOrderMappedFields {
  const order = unwrapLightfunnelsNode(payload)
  const shipping = asRecord(order.shipping_address)
  const billing = asRecord(order.billing_address)
  const customer = asRecord(order.customer)
  const orderId = stringValue(order.id, order._id)
  if (!orderId) throw new Error('Payload Lightfunnels sem id de pedido')

  const items = mapLightfunnelsItems(order.items)
  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0)
  const total = numberValue(order.total, 0) > 0 ? numberValue(order.total, 0) : itemsTotal
  const financialStatus = nullableString(order.financial_status)?.toLowerCase() ?? null
  const fullName = [shipping.first_name, shipping.last_name].map((v) => stringValue(v)).filter(Boolean).join(' ')
  const line1 = stringValue(shipping.line1, billing.line1)
  const line2 = stringValue(shipping.line2, billing.line2)

  return {
    source: 'lightfunnels',
    lightfunnels_integration_id: integration.id,
    lightfunnels_order_id: orderId,
    lightfunnels_order_name: nullableString(order.name),
    lightfunnels_funnel_id: nullableString(order.funnel_id),
    lightfunnels_store_id: nullableString(order.store_id),
    lightfunnels_financial_status: financialStatus,
    lightfunnels_fulfillment_status: nullableString(order.fulfillment_status)?.toLowerCase() ?? null,
    lightfunnels_cancelled_at: nullableDateString(order.cancelled_at),
    lightfunnels_archived_at: nullableDateString(order.archived_at),
    raw_lightfunnels_payload: order,
    order_placed_at: nullableDateString(order.created_at) ?? new Date().toISOString(),
    order_number: `lightfunnels-${integration.lfAccountId}-${orderId}`.slice(0, 240),
    instance_name: assignedInstanceName ?? '',
    assigned_instance_name: assignedInstanceName,
    country: lightfunnelsOrderCountry(order, integration.defaultCountry),
    contact_phone: normalizePhone(order.phone ?? shipping.phone ?? billing.phone ?? customer.phone),
    customer_name: stringValue(order.customer_full_name, fullName, customer.full_name, order.email, 'Cliente Lightfunnels'),
    email: nullableString(order.email, customer.email, shipping.email),
    address: [line1, line2].filter(Boolean).join(', ') || 'Endereço não informado',
    city: stringValue(shipping.city, billing.city, 'Cidade não informada'),
    province: stringValue(shipping.state, shipping.area, billing.state, billing.area, '-'),
    zipcode: stringValue(shipping.zip, billing.zip, '-'),
    payment_type: financialStatus === 'paid' ? 'PREPAID' : 'COD',
    items,
    total,
    currency: stringValue(order.currency, 'EUR').toUpperCase(),
  }
}

export interface UpsertLightfunnelsOrderOptions {
  // Enfileira o gatilho "Pedido Lightfunnels criado" (só order/confirmed).
  sendConfirmation?: boolean
  isSimulation?: boolean
  forceInstanceName?: string
  forceConversationId?: string
}

const EXISTING_ORDER_SELECT =
  'id, lead_number, status, assigned_instance_name, confirmation_message_sent_at, lightfunnels_financial_status, lightfunnels_cancelled_at, lightfunnels_archived_at'

export async function upsertLightfunnelsOrder(
  integrationRow: { id: string | null } & Pick<LightfunnelsIntegrationCredentialRow, 'lf_account_id' | 'default_country'>,
  payload: unknown,
  options: UpsertLightfunnelsOrderOptions = {}
) {
  const integration: IntegrationContext = {
    id: integrationRow.id,
    lfAccountId: integrationRow.lf_account_id,
    defaultCountry: integrationRow.default_country,
  }
  const order = unwrapLightfunnelsNode(payload)
  const country = lightfunnelsOrderCountry(order, integration.defaultCountry)
  const funnelId = nullableString(order.funnel_id)
  const assignedInstanceName = options.forceInstanceName
    ?? await assignConfirmationAccount(country, integration.id
      ? { platform: 'lightfunnels', integrationId: integration.id, funnelId }
      : undefined)
  const mapped = mapLightfunnelsOrderPayload(order, integration, assignedInstanceName)

  const existing = await findExistingOrder(integration.id, mapped.lightfunnels_order_id)
  const now = new Date().toISOString()
  // Conta já atribuída não muda em webhooks seguintes (operador pode ter
  // movido o pedido de conta à mão).
  const assigned = existing?.assigned_instance_name || mapped.assigned_instance_name
  const patch: Record<string, unknown> = {
    ...mapped,
    assigned_instance_name: assigned,
    instance_name: assigned ?? '',
    updated_at: now,
  }
  // funnel_id/store_id só vêm no webhook; uma leitura pela API não pode
  // apagá-los.
  if (!mapped.lightfunnels_funnel_id) delete patch.lightfunnels_funnel_id
  if (!mapped.lightfunnels_store_id) delete patch.lightfunnels_store_id

  let saved: Record<string, unknown>
  let isNewOrder = !existing
  if (existing) {
    saved = await updateOrder(existing.id, patch)
  } else {
    const { data, error } = await supabaseAdmin
      .from('fulfillment_orders')
      .insert({
        ...patch,
        status: 'pending_operator',
        commercial_status: 'Não responde',
        send_status: 'Pendente',
        delivery_status: 'Não enviado',
        is_simulation: options.isSimulation ?? false,
        conversation_id: options.forceConversationId ?? null,
      })
      .select()
      .single()
    if (error?.code === '23505') {
      // Dois webhooks do mesmo pedido ao mesmo tempo: o outro inseriu primeiro.
      const raced = await findExistingOrder(integration.id, mapped.lightfunnels_order_id)
      if (!raced) throw new Error(`Falha ao gravar pedido Lightfunnels: ${error.message}`)
      saved = await updateOrder(raced.id, { ...patch, assigned_instance_name: raced.assigned_instance_name || assigned })
      isNewOrder = false
    } else if (error || !data) {
      throw new Error(error?.message ?? 'Falha ao gravar pedido Lightfunnels')
    } else {
      saved = data as Record<string, unknown>
    }
  }
  const orderId = String(saved.id)

  if (existing && (
    existing.lightfunnels_financial_status !== mapped.lightfunnels_financial_status
    || existing.lightfunnels_cancelled_at !== mapped.lightfunnels_cancelled_at
  )) {
    await recordOrderEvent(orderId, 'lightfunnels_status_updated', {
      financial_status: mapped.lightfunnels_financial_status,
      cancelled_at: mapped.lightfunnels_cancelled_at,
    })
  }

  const becameCancelled = Boolean(mapped.lightfunnels_cancelled_at) && !existing?.lightfunnels_cancelled_at
  const becameArchived = Boolean(mapped.lightfunnels_archived_at) && !existing?.lightfunnels_archived_at
  if (becameCancelled || becameArchived) {
    await applyLightfunnelsCancellation(orderId, saved, becameCancelled ? 'cancelado' : 'arquivado')
    return saved
  }

  const alreadyTriggered = Boolean(existing?.confirmation_message_sent_at || saved.confirmation_message_sent_at)
  if (options.sendConfirmation && !alreadyTriggered && !mapped.lightfunnels_cancelled_at) {
    await enqueueOrderTrigger(orderId, String(saved.assigned_instance_name || saved.instance_name || ''), saved)
  }

  log.debug('order upserted', { orderId, isNewOrder, instance: saved.assigned_instance_name })
  return saved
}

async function findExistingOrder(integrationId: string | null, lightfunnelsOrderId: string) {
  if (!integrationId) return null
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select(EXISTING_ORDER_SELECT)
    .eq('lightfunnels_integration_id', integrationId)
    .eq('lightfunnels_order_id', lightfunnelsOrderId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar pedido Lightfunnels: ${error.message}`)
  return data as {
    id: string
    lead_number: string | null
    status: string
    assigned_instance_name: string | null
    confirmation_message_sent_at: string | null
    lightfunnels_financial_status: string | null
    lightfunnels_cancelled_at: string | null
    lightfunnels_archived_at: string | null
  } | null
}

async function updateOrder(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar pedido Lightfunnels')
  return data as Record<string, unknown>
}

async function enqueueOrderTrigger(orderId: string, instanceName: string, saved: Record<string, unknown>): Promise<void> {
  // Automação simples "Pedido criado" do país/linha tem precedência sobre o
  // gatilho da conta e sai pelo número dela.
  const automationMatch = saved.is_simulation ? null : await findOrderAutomation('order_created', saved)
  if (automationMatch) {
    await enqueueLightfunnelsOrderFlowJob({
      orderId,
      instanceName: automationMatch.automation.instance_name,
      flowId: automationMatch.step.flow_id,
      automationId: automationMatch.automation.id,
    })
    return
  }
  const { data: trigger, error } = await supabaseAdmin
    .from('triggers')
    .select('action_payload')
    .eq('instance_name', instanceName)
    .eq('source', 'lightfunnels_order')
    .eq('action', 'flow')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar gatilho Lightfunnels: ${error.message}`)
  const flowId = (trigger?.action_payload as Record<string, unknown> | null)?.flow_id
  if (typeof flowId === 'string' && flowId && instanceName) {
    await enqueueLightfunnelsOrderFlowJob({ orderId, instanceName, flowId })
    return
  }
  await supabaseAdmin
    .from('fulfillment_orders')
    .update({
      confirmation_message_error: instanceName
        ? 'Nenhum gatilho "Pedido Lightfunnels criado" configurado para esta conta'
        : 'Nenhuma conta WhatsApp para este pedido — vincule uma conta à integração Lightfunnels',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
}

// Mesma regra do pedido excluído na Shopify (archiveShopifyOrder): o cliente
// desistiu; se ainda não foi ao FenixCOD, sai da fila; o fluxo pendente
// é cancelado.
async function applyLightfunnelsCancellation(orderId: string, order: Record<string, unknown>, reason: 'cancelado' | 'arquivado') {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { commercial_status: 'Desistiu', updated_at: now }
  if (!order.lead_number && ['pending_operator', 'failed'].includes(String(order.status))) {
    patch.status = 'cancelled'
    patch.send_status = 'Não enviar'
  }
  const { error } = await supabaseAdmin.from('fulfillment_orders').update(patch).eq('id', orderId)
  if (error) throw new Error(`Falha ao marcar pedido Lightfunnels ${reason}: ${error.message}`)

  const { error: jobsError } = await supabaseAdmin
    .from('flow_jobs')
    .update({ status: 'failed', last_error: `Pedido ${reason} no Lightfunnels antes da execução do fluxo`, updated_at: now })
    .eq('order_id', orderId)
    .eq('job_type', 'lightfunnels_order_flow')
    .eq('status', 'pending')
  if (jobsError) throw new Error(`Pedido ${reason}, mas o job pendente não foi cancelado: ${jobsError.message}`)

  await recordOrderEvent(orderId, reason === 'cancelado' ? 'lightfunnels_order_cancelled' : 'lightfunnels_order_archived', {})
}

// Backfill pela API (botão Sincronizar): traz pedidos recentes sem disparar
// gatilho — mesma postura do sync Shopify, que só popula a fila.
export async function syncLightfunnelsOrders(
  integrationRow: LightfunnelsIntegrationCredentialRow,
  listPage: (after: string | null) => Promise<{ nodes: Record<string, unknown>[]; endCursor: string | null; hasNextPage: boolean }>,
  options: { maxPages?: number } = {}
): Promise<{ imported: number }> {
  let imported = 0
  let after: string | null = null
  for (let page = 0; page < (options.maxPages ?? 4); page++) {
    const result = await listPage(after)
    for (const node of result.nodes) {
      await upsertLightfunnelsOrder(integrationRow, node, { sendConfirmation: false })
      imported += 1
    }
    if (!result.hasNextPage || !result.endCursor) break
    after = result.endCursor
  }
  return { imported }
}

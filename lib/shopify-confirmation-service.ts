import 'server-only'
import { sendWhatsAppText } from './whatsapp-text'
import { normalizeShopDomain } from './shopify-client'
import { recordOrderEvent } from './fulfillment-service'
import { maybeAutoSubmitConfirmedOrder } from './fulfillment-order-state'
import {
  isCommercialStatus,
  isDeliveryStatus,
  isSendStatus,
  shouldSubmitToFenix,
} from './order-state'
import { executeFlow, interpolateTemplateBody } from './flow-engine'
import { getAccountProvider } from './whatsapp-account-provider'
import { isWithinMessagingWindow, OutsideMessagingWindowError } from './messaging-window'
import { loadWhatsAppTemplateById } from './whatsapp-templates'
import { dispatchSendTemplate } from './whatsapp-dispatch'
import { buildMessageTemplateValues, getMessagePlaceholders, renderMessageTemplate } from './message-template'
import { supabaseAdmin } from './supabase-admin'
import { recordOutboundMessage } from './outbound-message'
import { SANDBOX_INSTANCE_NAME } from './sandbox'
import { normalizePhone } from './phone'
import { syncShopifyProductsForIntegration } from './shopify-products-service'
import { ISO_TO_FULFILLMENT_COUNTRY } from './fulfillment-countries'
import {
  findOrderAutomation,
  findShopifyCartAutomation,
  getEnabledAutomationInstance,
  type CartAutomationMatch,
} from './automation-runtime'
import { AUTOMATION_TRIGGER_PREFIX, automationStepTriggerId } from './automation-rules'
import {
  abandonedCheckoutDedupeKey,
  cancelPendingAbandonedCheckoutJobs,
  cancelStaleAbandonedCheckoutJobs,
  enqueueAbandonedCheckoutFlowJob,
  enqueueShopifyOrderFlowJob,
} from './flow-jobs'
import { getShopifyTriggersEnabled } from './shopify-trigger-settings'
import { assignConfirmationAccount } from './order-account-routing'
import { createLogger } from './logger'
import { getOrderTriggersEnabled } from './lightfunnels-trigger-settings'
import { scheduleLightfunnelsWriteback } from './lightfunnels-writeback'
import {
  getPlatformCancelledMessage,
  getPlatformLabel,
  getPlatformRemovedMessage,
  isOrderCancelled,
  isOrderRemoved,
  orderTriggerSourceFor,
} from './order-platform'

const checkoutLog = createLogger('shopify-checkout')
import {
  calculatePhysicalUnitPrice,
  resolvePackQuantity,
  type PackQuantitySource,
} from './shopify-pack-quantity'
import {
  SHOPIFY_INTEGRATION_PUBLIC_SELECT,
  decodeShopifyAdminToken,
  decodeShopifyWebhookSecret,
  resolveShopifyWebhookSecret,
  resolveShopifyWebhookSecrets,
  shopifyClientFromIntegration,
  loadShopifyIntegrationForWebhook,
  listActiveShopifyIntegrations,
  type ShopifyIntegrationCredentialRow,
} from './shopify-integration-store'
import {
  ABANDONED_CHECKOUT_STATUSES,
  type AbandonedCheckoutStatus,
  type ShopifyCheckoutSource,
  type FulfillmentOrder,
  type OrderSource,
} from '@/types'

export {
  SHOPIFY_INTEGRATION_PUBLIC_SELECT,
  decodeShopifyAdminToken,
  decodeShopifyWebhookSecret,
  resolveShopifyWebhookSecret,
  resolveShopifyWebhookSecrets,
  shopifyClientFromIntegration,
  loadShopifyIntegrationForWebhook,
  listActiveShopifyIntegrations,
}
export type { ShopifyIntegrationCredentialRow }

export const MIN_CONFIRMATION_SEND_GAP_MS = 1_500

export async function reserveConfirmationSendSlot(): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('reserve_flow_send_slot', {
    p_key: 'confirmation_send',
    p_gap_ms: MIN_CONFIRMATION_SEND_GAP_MS,
  })
  if (error) throw new Error(`Falha ao reservar intervalo de envio: ${error.message}`)
  const reservedAt = new Date(String(data)).getTime()
  if (!Number.isFinite(reservedAt)) throw new Error('Banco retornou intervalo de envio invalido')
  const waitMs = reservedAt - Date.now()
  if (waitMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
  }
}

export function _resetConfirmationSendPacingForTests(): void {
  // Pacing is persisted in PostgreSQL. Tests reset their RPC mock instead.
}

type ShopifyIntegrationContext = {
  id: string
  shopDomain: string
  defaultCountry: string
}

type ShopifyOrderMappedFields = {
  source: 'shopify'
  shopify_integration_id: string
  shopify_order_id: string
  shopify_order_name: string | null
  shopify_order_number: string | null
  shopify_financial_status: string | null
  shopify_fulfillment_status: string | null
  shopify_cancelled_at: string | null
  shopify_cancel_reason: string | null
  shopify_closed_at: string | null
  order_placed_at: string
  raw_shopify_payload: Record<string, unknown>
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
  items: Array<{
    product_id: string
    shopify_product_id?: string
    shopify_variant_id?: string
    shopify_quantity?: number
    units_per_pack?: number
    pack_quantity_source?: PackQuantitySource
    sku: string
    name: string
    quantity: number
    unit_price: number
    total: number
  }>
  total: number
  currency: string
}

type ShopifyCheckoutMappedFields = {
  shopify_integration_id: string
  shopify_checkout_id: string | null
  checkout_token: string | null
  shop_domain: string
  assigned_instance_name: string | null
  country: string
  contact_phone: string | null
  customer_name: string | null
  email: string | null
  abandoned_checkout_url: string | null
  total: number
  currency: string
  shopify_completed_at: string | null
  raw_shopify_payload: Record<string, unknown>
}

export { isCommercialStatus, isDeliveryStatus, isSendStatus, shouldSubmitToFenix }

export function isAbandonedCheckoutStatus(value: unknown): value is AbandonedCheckoutStatus {
  return (ABANDONED_CHECKOUT_STATUSES as readonly string[]).includes(String(value))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function nullableString(...values: unknown[]): string | null {
  const value = stringValue(...values)
  return value || null
}

function nullableDateString(value: unknown): string | null {
  const raw = nullableString(value)
  if (!raw) return null
  const timestamp = new Date(raw)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(number) ? number : fallback
}

function normalizeCountry(value: unknown, fallback: string): string {
  const upper = stringValue(value, fallback).toUpperCase()
  return ISO_TO_FULFILLMENT_COUNTRY[upper] ?? upper
}

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

function customerName(order: Record<string, unknown>, shipping: Record<string, unknown>, billing: Record<string, unknown>) {
  const customer = asRecord(order.customer)
  const firstLast = [customer.first_name, customer.last_name].map((value) => stringValue(value)).filter(Boolean).join(' ')
  return stringValue(shipping.name, billing.name, firstLast, order.email, 'Cliente Shopify')
}

function mapLineItems(value: unknown): ShopifyOrderMappedFields['items'] {
  return asArray(value).flatMap((entry, index) => {
    const item = asRecord(entry)
    const shopifyQuantity = Math.max(0, Math.trunc(numberValue(item.current_quantity ?? item.quantity, 1)))
    if (shopifyQuantity === 0) return []
    const pack = resolvePackQuantity({
      rawSku: item.sku,
      titles: [item.variant_title, item.name, item.title],
    })
    const quantity = shopifyQuantity * pack.unitsPerPack
    const packPrice = Math.max(0, numberValue(item.price, 0))
    const grossTotal = packPrice * shopifyQuantity
    const discount = numberValue(item.total_discount, 0)
    const total = Math.max(0, discount > grossTotal ? grossTotal : grossTotal - discount)
    const unitPrice = calculatePhysicalUnitPrice(total, quantity)
    const shopifyProductId = stringValue(item.product_id)
    const shopifyVariantId = stringValue(item.variant_id)
    return [{
      product_id: stringValue(shopifyVariantId, shopifyProductId, `SHOPIFY-${index + 1}`),
      shopify_product_id: shopifyProductId || undefined,
      shopify_variant_id: shopifyVariantId || undefined,
      shopify_quantity: shopifyQuantity,
      units_per_pack: pack.unitsPerPack,
      pack_quantity_source: pack.source,
      sku: pack.sku,
      name: stringValue(item.name, item.title, pack.sku, `Produto Shopify ${index + 1}`),
      quantity,
      unit_price: unitPrice,
      total,
    }]
  })
}

// A escolha da conta é comum a todas as plataformas (lib/order-account-routing.ts).
export { assignConfirmationAccount }

export async function mapShopifyOrderPayload(
  payload: unknown,
  integration: ShopifyIntegrationContext,
  assignedInstanceName: string | null
): Promise<ShopifyOrderMappedFields> {
  const order = asRecord(payload)
  const shipping = asRecord(order.shipping_address)
  const billing = asRecord(order.billing_address)
  const shopifyOrderId = stringValue(order.id, order.admin_graphql_api_id)
  if (!shopifyOrderId) throw new Error('Payload Shopify sem id de pedido')

  const country = normalizeCountry(
    shipping.country_code ?? shipping.country ?? billing.country_code ?? billing.country,
    integration.defaultCountry
  )
  const items = mapLineItems(order.line_items)
  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0)
  const currentTotal = numberValue(order.current_total_price, 0)
  const originalTotal = numberValue(order.total_price, 0)
  const total = currentTotal > 0 ? currentTotal : originalTotal > 0 ? originalTotal : itemsTotal
  const currency = stringValue(order.currency, order.presentment_currency, 'EUR').toUpperCase()
  const phone = normalizePhone(order.phone ?? shipping.phone ?? billing.phone ?? asRecord(order.customer).phone)
  const orderName = nullableString(order.name)

  return {
    source: 'shopify',
    shopify_integration_id: integration.id,
    shopify_order_id: shopifyOrderId,
    shopify_order_name: orderName,
    shopify_order_number: nullableString(order.order_number, order.number),
    shopify_financial_status: nullableString(order.financial_status)?.toLowerCase() ?? null,
    shopify_fulfillment_status: nullableString(order.fulfillment_status)?.toLowerCase() ?? null,
    shopify_cancelled_at: nullableDateString(order.cancelled_at),
    shopify_cancel_reason: nullableString(order.cancel_reason)?.toLowerCase() ?? null,
    shopify_closed_at: nullableDateString(order.closed_at),
    // A Shopify sempre envia created_at num pedido real; o fallback só
    // cobre payload malformado, para nunca violar a constraint NOT NULL.
    order_placed_at: nullableDateString(order.created_at) ?? new Date().toISOString(),
    raw_shopify_payload: order,
    order_number: `shopify-${integration.shopDomain}-${shopifyOrderId}`.slice(0, 240),
    instance_name: assignedInstanceName ?? '',
    assigned_instance_name: assignedInstanceName,
    country,
    contact_phone: phone,
    customer_name: customerName(order, shipping, billing),
    email: nullableString(order.email, asRecord(order.customer).email),
    address: stringValue(shipping.address1, billing.address1, 'Endereço não informado'),
    city: stringValue(shipping.city, billing.city, 'Cidade não informada'),
    province: stringValue(shipping.province, shipping.province_code, billing.province, billing.province_code, '-'),
    zipcode: stringValue(shipping.zip, billing.zip, '-'),
    payment_type: String(order.financial_status ?? '').toLowerCase() === 'paid' ? 'PREPAID' : 'COD',
    items,
    total,
    currency,
  }
}

export async function upsertShopifyOrder(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown,
  options: {
    sendConfirmation?: boolean
    isSimulation?: boolean
    forceInstanceName?: string
    forceConversationId?: string
    // Interno: segunda tentativa depois de perder a corrida do insert.
    afterInsertConflict?: boolean
  } = {}
): Promise<FulfillmentOrder> {
  const integration = {
    id: integrationRow.id,
    shopDomain: normalizeShopDomain(integrationRow.shop_domain),
    defaultCountry: integrationRow.default_country,
  }
  const preliminaryOrder = asRecord(payload)
  const shipping = asRecord(preliminaryOrder.shipping_address)
  const billing = asRecord(preliminaryOrder.billing_address)
  const country = normalizeCountry(
    shipping.country_code ?? shipping.country ?? billing.country_code ?? billing.country,
    integration.defaultCountry
  )
  const assignedInstanceName = options.forceInstanceName ?? await assignConfirmationAccount(country, integration.id)
  const mapped = await mapShopifyOrderPayload(payload, integration, assignedInstanceName)

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, assigned_instance_name, commercial_status, send_status, delivery_status, confirmation_message_sent_at, shopify_financial_status, shopify_cancelled_at')
    .eq('shopify_integration_id', integration.id)
    .eq('shopify_order_id', mapped.shopify_order_id)
    .maybeSingle()
  if (existingError) throw new Error(`Falha ao consultar pedido Shopify: ${existingError.message}`)

  const isNewOrder = !existing?.id
  const now = new Date().toISOString()
  const existingAssigned = typeof existing?.assigned_instance_name === 'string' && existing.assigned_instance_name
    ? existing.assigned_instance_name
    : mapped.assigned_instance_name
  const patch = {
    ...mapped,
    assigned_instance_name: existingAssigned,
    instance_name: existingAssigned ?? '',
    shopify_deleted_at: null,
    updated_at: now,
  }

  const result = isNewOrder
    ? await supabaseAdmin
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
    : await supabaseAdmin
      .from('fulfillment_orders')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single()

  // A Shopify manda orders/create e orders/updated do mesmo pedido quase ao
  // mesmo tempo: os dois veem "pedido novo" e os dois inserem — o segundo
  // bate na chave única. Refaz uma vez: agora o pedido existe e vira update,
  // e a confirmação do orders/create não se perde (o job é deduplicado por
  // pedido).
  if (isNewOrder && result.error?.code === '23505' && !options.afterInsertConflict) {
    return upsertShopifyOrder(integrationRow, payload, { ...options, afterInsertConflict: true })
  }

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Falha ao gravar pedido Shopify')
  }

  await markAbandonedCheckoutsConvertedByOrder(integration.id, payload)

  if (!isNewOrder && (
    existing.shopify_financial_status !== mapped.shopify_financial_status ||
    existing.shopify_cancelled_at !== mapped.shopify_cancelled_at
  )) {
    await recordOrderEvent(result.data.id, 'shopify_status_updated', {
      financial_status: mapped.shopify_financial_status,
      cancelled_at: mapped.shopify_cancelled_at,
      cancel_reason: mapped.shopify_cancel_reason,
    })
  }

  if ((isNewOrder || options.afterInsertConflict) && options.sendConfirmation !== false && !existing?.confirmation_message_sent_at) {
    // Automação simples "Pedido criado" do país/linha tem precedência sobre o
    // gatilho da conta e sai pelo número dela.
    const automationMatch = result.data.is_simulation ? null : await findOrderAutomation('order_created', result.data)
    if (automationMatch) {
      await enqueueShopifyOrderFlowJob({
        orderId: result.data.id,
        instanceName: automationMatch.automation.instance_name,
        flowId: automationMatch.step.flow_id,
        automationId: automationMatch.automation.id,
      })
      return result.data
    }
    const instanceName = String(result.data.assigned_instance_name || result.data.instance_name || '')
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from('triggers')
      .select('action_payload')
      .eq('instance_name', instanceName)
      .eq('source', 'shopify_order')
      .eq('action', 'flow')
      .limit(1)
      .maybeSingle()
    if (triggerError) throw new Error(`Falha ao consultar gatilho Shopify: ${triggerError.message}`)
    const flowId = trigger?.action_payload?.flow_id as string | undefined
    if (flowId) {
      await enqueueShopifyOrderFlowJob({
        orderId: result.data.id,
        instanceName,
        flowId,
      })
    } else {
      await supabaseAdmin
        .from('fulfillment_orders')
        .update({
          confirmation_message_error: 'Nenhum gatilho "Pedido Shopify criado" configurado para esta conta',
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.data.id)
    }
  }

  return result.data
}

export async function archiveShopifyOrder(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown
) {
  const shopifyOrderId = stringValue(asRecord(payload).id, asRecord(payload).admin_graphql_api_id)
  if (!shopifyOrderId) throw new Error('Payload Shopify sem id de pedido')

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, lead_number, status, shopify_deleted_at')
    .eq('shopify_integration_id', integrationRow.id)
    .eq('shopify_order_id', shopifyOrderId)
    .maybeSingle()
  if (existingError) throw new Error(`Falha ao consultar pedido Shopify: ${existingError.message}`)
  if (!existing) return null

  const now = new Date().toISOString()
  let archived = existing
  if (!existing.shopify_deleted_at) {
    const patch: Record<string, unknown> = {
      shopify_deleted_at: now,
      commercial_status: 'Desistiu',
      updated_at: now,
    }
    if (!existing.lead_number && ['pending_operator', 'failed'].includes(String(existing.status))) {
      patch.status = 'cancelled'
      patch.send_status = 'Não enviar'
    }

    const { data, error: archiveError } = await supabaseAdmin
      .from('fulfillment_orders')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single()
    if (archiveError || !data) {
      throw new Error(archiveError?.message ?? 'Falha ao arquivar pedido excluído no Shopify')
    }
    archived = data
  }

  const { error: jobsError } = await supabaseAdmin
    .from('flow_jobs')
    .update({
      status: 'failed',
      last_error: 'Pedido excluído no Shopify antes da execução do fluxo',
      updated_at: now,
    })
    .eq('order_id', existing.id)
    .eq('job_type', 'shopify_order_flow')
    .eq('status', 'pending')
  if (jobsError) throw new Error(`Pedido arquivado, mas o job pendente não foi cancelado: ${jobsError.message}`)

  if (!existing.shopify_deleted_at) {
    await recordOrderEvent(existing.id, 'shopify_order_deleted', { shopify_order_id: shopifyOrderId })
  }
  return archived
}

export function mapShopifyAbandonedCheckoutPayload(
  payload: unknown,
  integration: ShopifyIntegrationContext,
  assignedInstanceName: string | null
): ShopifyCheckoutMappedFields {
  const checkout = asRecord(payload)
  const shipping = asRecord(checkout.shipping_address)
  const billing = asRecord(checkout.billing_address)
  const customer = asRecord(checkout.customer)
  const country = normalizeCountry(
    shipping.country_code ?? shipping.country ?? billing.country_code ?? billing.country,
    integration.defaultCountry
  )
  const phone = normalizePhone(checkout.phone ?? shipping.phone ?? billing.phone ?? customer.phone)
  const name = stringValue(
    shipping.name,
    billing.name,
    [customer.first_name, customer.last_name].map((value) => stringValue(value)).filter(Boolean).join(' ')
  )

  return {
    shopify_integration_id: integration.id,
    shopify_checkout_id: nullableString(checkout.id),
    checkout_token: nullableString(checkout.token, checkout.cart_token),
    shop_domain: integration.shopDomain,
    assigned_instance_name: assignedInstanceName,
    country,
    contact_phone: phone || null,
    customer_name: name || null,
    email: nullableString(checkout.email, customer.email),
    abandoned_checkout_url: nullableString(checkout.abandoned_checkout_url, checkout.web_url, checkout.invoice_url),
    total: numberValue(checkout.total_price, numberValue(checkout.current_total_price, 0)),
    currency: stringValue(checkout.currency, checkout.presentment_currency, 'EUR').toUpperCase(),
    shopify_completed_at: nullableDateString(checkout.completed_at),
    raw_shopify_payload: checkout,
  }
}

// Sem delay configurado, o gatilho dispararia no instante em que o cliente
// entra no checkout — ainda pagando. 60 min é o padrão combinado.
export const DEFAULT_ABANDONED_CHECKOUT_DELAY_MS = 60 * 60 * 1000
// Checkout cuja hora ideal de envio já passou há mais que isso não é
// agendado (ex: webhook reentregue dias depois) — lembrete atrasado só incomoda.
const ABANDONED_CHECKOUT_MAX_LATENESS_MS = 6 * 60 * 60 * 1000

type AbandonedCheckoutRow = {
  id: string
  shopify_integration_id: string | null
  checkout_token: string | null
  assigned_instance_name: string | null
  contact_phone: string | null
  customer_name: string | null
  recovery_status: string
  is_simulation: boolean
  shopify_completed_at: string | null
  raw_shopify_payload: Record<string, unknown> | null
  created_at: string
  country?: string | null
}

// Última atividade do cliente no checkout segundo a Shopify — é a partir
// dela que o delay conta, não da hora em que o webhook chegou.
function checkoutLastActivityAt(checkout: AbandonedCheckoutRow): number {
  const raw = asRecord(checkout.raw_shopify_payload)
  const shopifyTimestamp = nullableDateString(raw.updated_at) ?? nullableDateString(raw.created_at)
  return new Date(shopifyTimestamp ?? checkout.created_at).getTime()
}

// Lembretes de uma automação simples (aba Automações) para o carrinho. Ela
// tem precedência sobre os gatilhos "Carrinho abandonado" da conta: os jobs
// pendentes que não são dela são cancelados, para o cliente não receber os
// dois lembretes.
async function scheduleCartAutomationSteps(
  checkout: AbandonedCheckoutRow,
  match: CartAutomationMatch,
  lastActivityAt: number
): Promise<number> {
  const { automation } = match
  const now = Date.now()
  const keep = new Set<string>()
  let scheduled = 0
  for (const step of automation.steps) {
    if (!step.flow_id) continue
    const triggerId = automationStepTriggerId(automation.id, step.position)
    keep.add(abandonedCheckoutDedupeKey(checkout.id, triggerId))
    const idealRunAt = lastActivityAt + step.delay_minutes * 60 * 1000
    if (idealRunAt < now - ABANDONED_CHECKOUT_MAX_LATENESS_MS) continue
    await enqueueAbandonedCheckoutFlowJob({
      checkoutId: checkout.id,
      triggerId,
      instanceName: automation.instance_name,
      flowId: step.flow_id,
      runAt: new Date(Math.max(now, idealRunAt)),
      automationId: automation.id,
    })
    scheduled += 1
  }
  await cancelStaleAbandonedCheckoutJobs(
    checkout.id,
    (dedupeKey) => keep.has(dedupeKey),
    `Substituído pela automação "${automation.name}"`
  )
  checkoutLog.info('automação de carrinho agendada', {
    checkoutId: checkout.id,
    automationId: automation.id,
    productLineId: match.productLineId ?? 'none',
    instance: automation.instance_name,
    scheduled,
  })
  return scheduled
}

// `ignoreDelay` (só no sandbox) agenda para agora, sem esperar o delay do
// gatilho — para testar o fluxo sem aguardar 60 min.
async function scheduleAbandonedCheckoutTriggers(
  checkout: AbandonedCheckoutRow,
  options: { ignoreDelay?: boolean } = {}
): Promise<number> {
  const instanceName = checkout.assigned_instance_name ?? ''
  const isSandbox = instanceName === SANDBOX_INSTANCE_NAME
  // Simulação só roda na conta sandbox, nunca numa conta real.
  if (checkout.is_simulation && !isSandbox) return 0
  if (checkout.recovery_status !== 'Pendente' || checkout.shopify_completed_at) return 0
  // Cada motivo de não agendar vai para o log — sem isso, um carrinho que
  // chegou mas não gerou mensagem é indistinguível de um que nunca chegou.
  const skip = (reason: string) => {
    checkoutLog.info('gatilho de carrinho não agendado', { checkoutId: checkout.id, instance: instanceName || 'none', reason })
    return 0
  }
  // Carrinho sem telefone (só e-mail) é ignorado — não há para quem mandar WhatsApp.
  if (!checkout.contact_phone) return skip('sem telefone')
  // O interruptor global pausa automações reais; o sandbox segue testável,
  // como acontece com os pedidos simulados.
  if (!isSandbox && !(await getShopifyTriggersEnabled())) return skip('Gatilhos Shopify pausados')

  const lastActivityAt = checkoutLastActivityAt(checkout)
  // Automação simples escolhe o próprio número — não depende da conta
  // atribuída ao carrinho. Carrinho simulado nunca usa automação real.
  if (!isSandbox && !checkout.is_simulation && checkout.shopify_integration_id) {
    const match = await findShopifyCartAutomation({
      integrationId: checkout.shopify_integration_id,
      country: checkout.country ?? null,
      payload: checkout.raw_shopify_payload,
    })
    if (match) return scheduleCartAutomationSteps(checkout, match, lastActivityAt)
    // A automação que valia para este carrinho deixou de valer (desligada,
    // apagada ou o carrinho mudou de país/produto): os lembretes dela saem.
    await cancelStaleAbandonedCheckoutJobs(
      checkout.id,
      (dedupeKey) => !dedupeKey.includes(`:${AUTOMATION_TRIGGER_PREFIX}`),
      'Automação de carrinho não se aplica mais'
    )
  }

  if (!instanceName) return skip('sem conta WhatsApp atribuída')

  const { data: triggers, error } = await supabaseAdmin
    .from('triggers')
    .select('id, delay_ms, action_payload')
    .eq('instance_name', instanceName)
    .eq('source', 'shopify_abandoned_checkout')
    .eq('action', 'flow')
  if (error) throw new Error(`Falha ao consultar gatilhos de carrinho: ${error.message}`)

  const now = Date.now()
  let scheduled = 0
  for (const trigger of triggers ?? []) {
    const flowId = asRecord(trigger.action_payload).flow_id
    if (typeof flowId !== 'string' || !flowId) continue
    const delayMs = Number(trigger.delay_ms) > 0 ? Number(trigger.delay_ms) : DEFAULT_ABANDONED_CHECKOUT_DELAY_MS
    const idealRunAt = options.ignoreDelay && isSandbox ? now : lastActivityAt + delayMs
    if (idealRunAt < now - ABANDONED_CHECKOUT_MAX_LATENESS_MS) continue
    await enqueueAbandonedCheckoutFlowJob({
      checkoutId: checkout.id,
      triggerId: String(trigger.id),
      instanceName,
      flowId,
      runAt: new Date(Math.max(now, idealRunAt)),
    })
    scheduled += 1
  }
  if ((triggers ?? []).length === 0) return skip('conta sem gatilho "Carrinho abandonado" nem automação')
  checkoutLog.info('gatilho de carrinho agendado', { checkoutId: checkout.id, instance: instanceName, scheduled })
  return scheduled
}

async function markCheckoutsConverted(checkoutIds: string[], reason: string): Promise<void> {
  if (checkoutIds.length === 0) return
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .update({ recovery_status: 'Convertido', recovered_at: now, updated_at: now })
    .in('id', checkoutIds)
    .neq('recovery_status', 'Convertido')
  if (error) throw new Error(`Falha ao marcar carrinho como convertido: ${error.message}`)
  await cancelPendingAbandonedCheckoutJobs(checkoutIds, reason)
}

// Um pedido Shopify carrega checkout_token/checkout_id do checkout que o
// originou: esse carrinho não está mais abandonado. Marca como Convertido e
// cancela os lembretes ainda pendentes.
export async function markAbandonedCheckoutsConvertedByOrder(
  integrationId: string,
  orderPayload: unknown
): Promise<string[]> {
  const order = asRecord(orderPayload)
  const checkoutToken = nullableString(order.checkout_token)
  const checkoutId = nullableString(order.checkout_id)
  if (!checkoutToken && !checkoutId) return []

  const ids = new Set<string>()
  for (const [column, value] of [['checkout_token', checkoutToken], ['shopify_checkout_id', checkoutId]] as const) {
    if (!value) continue
    const { data, error } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .select('id')
      .eq('shopify_integration_id', integrationId)
      .eq(column, value)
    if (error) throw new Error(`Falha ao consultar checkout do pedido: ${error.message}`)
    for (const row of data ?? []) ids.add(String(row.id))
  }
  await markCheckoutsConverted([...ids], 'Carrinho convertido em pedido')
  return [...ids]
}

export async function upsertShopifyAbandonedCheckout(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown,
  options: { scheduleTriggers?: boolean; source?: ShopifyCheckoutSource; shopifyName?: string | null } = {}
) {
  const integration = {
    id: integrationRow.id,
    shopDomain: normalizeShopDomain(integrationRow.shop_domain),
    defaultCountry: integrationRow.default_country,
  }
  const checkout = asRecord(payload)
  const shipping = asRecord(checkout.shipping_address)
  const billing = asRecord(checkout.billing_address)
  const country = normalizeCountry(
    shipping.country_code ?? shipping.country ?? billing.country_code ?? billing.country,
    integration.defaultCountry
  )
  const assignedInstanceName = await assignConfirmationAccount(country, integration.id)
  const mapped = mapShopifyAbandonedCheckoutPayload(payload, integration, assignedInstanceName)

  const { data: existing, error: existingError } = mapped.shopify_checkout_id
    ? await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .select('id, assigned_instance_name, recovery_status')
      .eq('shopify_integration_id', integration.id)
      .eq('shopify_checkout_id', mapped.shopify_checkout_id)
      .maybeSingle()
    : { data: null, error: null }
  if (existingError) throw new Error(`Falha ao consultar checkout Shopify: ${existingError.message}`)

  const existingAssigned = typeof existing?.assigned_instance_name === 'string' && existing.assigned_instance_name
    ? existing.assigned_instance_name
    : mapped.assigned_instance_name
  const now = new Date().toISOString()
  // completed_at preenchido = a Shopify já converteu este checkout em pedido.
  const completedNow = Boolean(mapped.shopify_completed_at) && existing?.recovery_status !== 'Convertido'
  const patch = {
    ...mapped,
    assigned_instance_name: existingAssigned,
    // Só rascunhos gravam source/shopify_name: checkouts usam o padrão da
    // coluna, e assim continuam funcionando mesmo antes da migration 028.
    ...(options.source === 'draft_order' ? { source: 'draft_order', shopify_name: options.shopifyName ?? null } : {}),
    ...(completedNow ? { recovery_status: 'Convertido', recovered_at: now } : {}),
    updated_at: now,
  }

  const result = existing?.id
    ? await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single()
    : await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .insert({
        recovery_status: 'Pendente',
        ...patch,
        is_simulation: false,
      })
      .select()
      .single()

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Falha ao gravar checkout Shopify')
  }

  const saved = result.data as AbandonedCheckoutRow
  if (completedNow && existing?.id) {
    await cancelPendingAbandonedCheckoutJobs([saved.id], 'Checkout concluído na Shopify')
  } else if (options.scheduleTriggers !== false) {
    await scheduleAbandonedCheckoutTriggers(saved)
  }
  return result.data
}

export const DRAFT_ORDER_CHECKOUT_PREFIX = 'draft:'

// Rascunho (draft order) no formato que o mapeamento de checkout entende.
// Concluído na Shopify (status completed / order_id preenchido) = convertido
// em pedido; o link de retomada é a fatura do rascunho (invoice_url).
export function normalizeDraftOrderPayload(payload: unknown): Record<string, unknown> {
  const draft = asRecord(payload)
  const draftId = nullableString(draft.id)
  const completed = String(draft.status ?? '').toLowerCase() === 'completed' || Boolean(draft.order_id)
  return {
    ...draft,
    id: draftId ? `${DRAFT_ORDER_CHECKOUT_PREFIX}${draftId}` : null,
    token: null,
    abandoned_checkout_url: nullableString(draft.invoice_url),
    completed_at: nullableDateString(draft.completed_at) ?? (completed ? nullableDateString(draft.updated_at) ?? new Date().toISOString() : null),
  }
}

// draft_orders/create e draft_orders/update: o rascunho aberto é tratado como
// carrinho abandonado (mesmo gatilho e mesmo tempo configurável).
export async function upsertShopifyDraftOrder(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown,
  options: { scheduleTriggers?: boolean } = {}
) {
  const draft = asRecord(payload)
  if (!nullableString(draft.id)) throw new Error('Payload de rascunho Shopify sem id')
  return upsertShopifyAbandonedCheckout(integrationRow, normalizeDraftOrderPayload(draft), {
    ...options,
    source: 'draft_order',
    shopifyName: nullableString(draft.name),
  })
}

// draft_orders/delete: o link da fatura deixa de existir, então não há o que
// recuperar — cancela os lembretes pendentes e marca "Não enviar". Um rascunho
// já convertido em pedido fica como está.
export async function removeShopifyDraftOrder(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown
): Promise<{ id: string } | null> {
  const draftId = nullableString(asRecord(payload).id)
  if (!draftId) return null
  const { data, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .select('id, recovery_status')
    .eq('shopify_integration_id', integrationRow.id)
    .eq('shopify_checkout_id', `${DRAFT_ORDER_CHECKOUT_PREFIX}${draftId}`)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar rascunho Shopify: ${error.message}`)
  if (!data) return null
  if (data.recovery_status !== 'Convertido') {
    const now = new Date().toISOString()
    const { error: updateError } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({ recovery_status: 'Não enviar', last_error: 'Rascunho excluído na Shopify', updated_at: now })
      .eq('id', data.id)
    if (updateError) throw new Error(`Falha ao atualizar rascunho Shopify: ${updateError.message}`)
    await cancelPendingAbandonedCheckoutJobs([String(data.id)], 'Rascunho excluído na Shopify')
  }
  return { id: String(data.id) }
}

// Carrinho abandonado simulado pelo Sandbox: mesmo mapeamento do webhook
// real, mas preso à conta sandbox e ao contato de teste escolhido
// (is_simulation=true). Nunca toca a Shopify; o fluxo só manda WhatsApp de
// verdade se o contato de teste tiver envio real ligado.
export async function createSandboxAbandonedCheckout(input: {
  integrationId: string | null
  shopDomain: string
  defaultCountry: string
  payload: unknown
  contactPhone: string
  immediate: boolean
  source?: ShopifyCheckoutSource
}): Promise<{ checkout: Record<string, unknown>; scheduled: number }> {
  const isDraft = input.source === 'draft_order'
  const draftName = isDraft ? nullableString(asRecord(input.payload).name) : null
  const mapped = mapShopifyAbandonedCheckoutPayload(isDraft ? normalizeDraftOrderPayload(input.payload) : input.payload, {
    id: input.integrationId ?? '',
    shopDomain: normalizeShopDomain(input.shopDomain),
    defaultCountry: input.defaultCountry,
  }, SANDBOX_INSTANCE_NAME)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .insert({
      ...mapped,
      shopify_integration_id: input.integrationId,
      // Telefone exatamente como na conversa de teste: é por ele que o fluxo
      // encontra a conversa na hora de rodar.
      contact_phone: input.contactPhone,
      recovery_status: 'Pendente',
      is_simulation: true,
      ...(isDraft ? { source: 'draft_order', shopify_name: draftName } : {}),
      updated_at: now,
    })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao gravar carrinho simulado')

  const scheduled = await scheduleAbandonedCheckoutTriggers(data as AbandonedCheckoutRow, { ignoreDelay: input.immediate })
  return { checkout: data as Record<string, unknown>, scheduled }
}

// Um pedido desse telefone nesta integração feito depois do checkout conta
// como conversão mesmo sem checkout_token (ex: cliente abandonou um checkout
// e comprou por outro). Rede de segurança do momento do envio — o
// cruzamento por token no webhook de pedidos é o caminho principal.
async function findOrderConvertingCheckout(checkout: AbandonedCheckoutRow): Promise<boolean> {
  if (checkout.checkout_token && checkout.shopify_integration_id) {
    const { data, error } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('id')
      .eq('shopify_integration_id', checkout.shopify_integration_id)
      .eq('raw_shopify_payload->>checkout_token', checkout.checkout_token)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Falha ao consultar pedido do checkout: ${error.message}`)
    if (data) return true
  }

  const checkoutCreatedAt = nullableDateString(asRecord(checkout.raw_shopify_payload).created_at) ?? checkout.created_at
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id')
    .eq('contact_phone', String(checkout.contact_phone ?? ''))
    .gte('order_placed_at', checkoutCreatedAt)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar pedido do cliente: ${error.message}`)
  return Boolean(data)
}

// Executa o fluxo do gatilho "Carrinho abandonado". Tudo é conferido de novo
// aqui, na hora do envio, porque entre o agendamento e agora o cliente pode
// ter comprado, o operador pode ter marcado "Não enviar" etc. Motivos de
// "não enviar" retornam skipped (o job conclui sem retry); falhas reais
// lançam para o worker tentar de novo.
// `automationId`: lembrete de automação simples — sai pelo número atual dela
// e não sai se ela foi desligada depois do agendamento.
export async function runAbandonedCheckoutTrigger(
  checkoutId: string,
  flowId: string,
  options: { automationId?: string } = {}
) {
  const { data, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .select('*')
    .eq('id', checkoutId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar checkout: ${error.message}`)
  if (!data) return { skipped: 'Checkout não encontrado' }
  const checkout = data as AbandonedCheckoutRow

  if (checkout.is_simulation && checkout.assigned_instance_name !== SANDBOX_INSTANCE_NAME) {
    return { skipped: 'Checkout de simulação' }
  }
  if (checkout.recovery_status === 'Convertido' || checkout.recovery_status === 'Não enviar') {
    return { skipped: `Checkout com status ${checkout.recovery_status}` }
  }
  let instanceName = String(checkout.assigned_instance_name ?? '')
  if (options.automationId) {
    const automationInstance = await getEnabledAutomationInstance(options.automationId)
    if (!automationInstance) return { skipped: 'Automação desligada ou apagada' }
    instanceName = automationInstance
  }
  const phone = String(checkout.contact_phone ?? '')
  if (!instanceName || !phone) return { skipped: 'Checkout sem conta WhatsApp ou telefone' }
  if (checkout.shopify_completed_at || await findOrderConvertingCheckout(checkout)) {
    await markCheckoutsConverted([checkout.id], 'Carrinho convertido em pedido')
    return { skipped: 'Carrinho já convertido em pedido' }
  }

  try {
    const isSandbox = instanceName === SANDBOX_INSTANCE_NAME
    const { conversationId, remoteJid, realSendInstanceName } = await resolveConversationForOrder(
      instanceName,
      phone,
      String(checkout.customer_name || '')
    )
    if (!isSandbox) await reserveConfirmationSendSlot()
    await executeFlow(flowId, {
      instanceName,
      remoteJid,
      conversationId,
      incomingMessage: '',
      checkoutId: checkout.id,
      isSandbox,
      realSendInstanceName: isSandbox ? realSendInstanceName : undefined,
    })

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({ recovery_status: 'Enviado', whatsapp_sent_at: now, last_error: null, updated_at: now })
      .eq('id', checkout.id)
      .in('recovery_status', ['Pendente', 'Enviado'])
      .select()
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    return { checkout: updated ?? checkout, conversationId }
  } catch (runError) {
    const messageText = runError instanceof Error ? runError.message : 'Falha ao executar fluxo de carrinho abandonado'
    await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({ last_error: messageText, updated_at: new Date().toISOString() })
      .eq('id', checkout.id)
    throw runError
  }
}

const DEFAULT_RECOVERY_TEMPLATE =
  'Olá{{nome}}!\nSeu carrinho de {{currency}} {{total}} ainda está disponível.{{link}}\nResponda esta mensagem se quiser ajuda para finalizar.'

// Finds or creates the conversation for a Shopify order's contact, preferring
// an existing conversation matched by phone (so a customer who already has a
// real WhatsApp thread doesn't get a duplicate one from a synthetic wa_id).
async function resolveConversationForOrder(instanceName: string, phone: string, customerName: string) {
  const { data: existingConv } = await supabaseAdmin
    .from('conversations')
    .select('id, wa_id, sandbox_source_instance, sandbox_real_send_enabled')
    .eq('instance_name', instanceName)
    .eq('contact_phone', phone)
    .maybeSingle()
  if (existingConv?.id) {
    return {
      conversationId: existingConv.id as string,
      remoteJid: existingConv.wa_id as string,
      realSendInstanceName: existingConv.sandbox_real_send_enabled && existingConv.sandbox_source_instance
        ? existingConv.sandbox_source_instance as string
        : undefined,
    }
  }

  // Cloud API identifica contatos por dígitos puros — o mesmo formato que
  // a Meta manda em contacts[].wa_id no webhook (ver processInboundMessage
  // em app/api/webhook/whatsapp-cloud/route.ts). @s.whatsapp.net é um
  // sufixo de JID exclusivo da Evolution/Baileys: usá-lo aqui quebraria o
  // campo "to" enviado à Graph API e, pior, criaria uma conversa duplicada
  // (wa_id diferente) na próxima vez que esse contato mandasse mensagem de
  // verdade e o webhook fizesse upsert pelo wa_id sem sufixo.
  const provider = await getAccountProvider(instanceName)
  const remoteJid = provider === 'cloud_api' ? phone : `${phone}@s.whatsapp.net`
  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      { wa_id: remoteJid, instance_name: instanceName, contact_phone: phone, contact_name: customerName },
      { onConflict: 'wa_id, instance_name' }
    )
    .select('id')
    .single()
  if (error || !created) throw new Error(error?.message ?? 'Falha ao criar conversa para o pedido')
  return { conversationId: created.id as string, remoteJid, realSendInstanceName: undefined }
}

const ORDER_FLOW_SELECT =
  'id, source, customer_name, contact_phone, assigned_instance_name, instance_name, is_simulation, shopify_deleted_at, shopify_cancelled_at, lightfunnels_archived_at, lightfunnels_cancelled_at'

type OrderFlowOrder = {
  id: string
  source?: OrderSource | null
  customer_name: string | null
  contact_phone: string | null
  assigned_instance_name: string | null
  instance_name: string | null
  is_simulation: boolean
  shopify_deleted_at: string | null
  shopify_cancelled_at: string | null
  lightfunnels_archived_at?: string | null
  lightfunnels_cancelled_at?: string | null
}

async function executeOrderFlowForOrder(
  orderId: string,
  flowId: string,
  order: OrderFlowOrder,
  options: { paceAutomatedSend?: boolean } = {}
) {
  const instanceName = String(order.assigned_instance_name || order.instance_name || '')
  const phone = String(order.contact_phone || '')
  const isSandboxOrder = instanceName === SANDBOX_INSTANCE_NAME
  if (isOrderCancelled(order)) throw new Error(`${getPlatformCancelledMessage(order)}; fluxo bloqueado`)
  if (isOrderRemoved(order)) throw new Error(`${getPlatformRemovedMessage(order)}; fluxo bloqueado`)
  if (order.is_simulation && !isSandboxOrder) throw new Error('Pedido de simulação não envia WhatsApp real')
  if (!instanceName) throw new Error('Pedido sem conta WhatsApp atribuída')
  if (!phone) throw new Error('Pedido sem telefone para executar o fluxo')

  const { conversationId, remoteJid, realSendInstanceName } = await resolveConversationForOrder(
    instanceName,
    phone,
    String(order.customer_name || '')
  )
  const { error: conversationUpdateError } = await supabaseAdmin
    .from('fulfillment_orders')
    .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (conversationUpdateError) throw new Error(conversationUpdateError.message)

  if (!isSandboxOrder && options.paceAutomatedSend !== false) {
    await reserveConfirmationSendSlot()
  }

  await executeFlow(flowId, {
    instanceName,
    remoteJid,
    conversationId,
    incomingMessage: '',
    orderId,
    isSandbox: isSandboxOrder,
    realSendInstanceName: isSandboxOrder ? realSendInstanceName : undefined,
  })
  return { order, conversationId, remoteJid }
}

// Pedido atendido por automação simples: sai pelo número atual dela; null
// quando ela foi desligada ou apagada depois de o job ser enfileirado.
async function withAutomationInstance<T extends { assigned_instance_name: string | null }>(
  order: T,
  automationId: string | undefined
): Promise<T | null> {
  if (!automationId) return order
  const instanceName = await getEnabledAutomationInstance(automationId)
  return instanceName ? { ...order, assigned_instance_name: instanceName } : null
}

export async function runOrderFlow(
  orderId: string,
  flowId: string,
  options: { paceAutomatedSend?: boolean; automationId?: string } = {}
) {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select(ORDER_FLOW_SELECT)
    .eq('id', orderId)
    .single()
  if (error || !order) throw new Error(error?.message ?? 'Pedido não encontrado')
  const target = await withAutomationInstance(order as OrderFlowOrder, options.automationId)
  if (!target) return { order, skipped: true }
  return executeOrderFlowForOrder(orderId, flowId, target, { paceAutomatedSend: options.paceAutomatedSend })
}

// Runs the "Pedido criado" flow trigger of the order's platform (Shopify ou
// Lightfunnels) configured for the order's account. Replaces the old
// fixed-template confirmation message — there is no static fallback: if no
// trigger is configured, nothing is sent, by design.
export async function runShopifyOrderTrigger(
  orderId: string,
  flowIdOverride?: string,
  options: { respectShopifyTriggerSetting?: boolean; automationId?: string } = {}
) {
  const { data: loaded, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select(ORDER_FLOW_SELECT)
    .eq('id', orderId)
    .single()
  if (error || !loaded) throw new Error(error?.message ?? 'Pedido não encontrado')
  const order = await withAutomationInstance(loaded as OrderFlowOrder, options.automationId)
  if (!order) return { order: loaded, skipped: true }
  const instanceName = String(order.assigned_instance_name || order.instance_name || '')
  const isSandboxOrder = instanceName === SANDBOX_INSTANCE_NAME
  if (order.is_simulation && !isSandboxOrder) throw new Error('Pedido de simulação não envia WhatsApp real')
  const phone = String(order.contact_phone || '')
  if (!instanceName) throw new Error('Pedido sem conta WhatsApp atribuída')
  if (!phone) throw new Error('Pedido sem telefone para confirmação')

  try {
    let flowId = flowIdOverride
    if (!flowId) {
      const { data: trigger } = await supabaseAdmin
        .from('triggers')
        .select('action_payload')
        .eq('instance_name', instanceName)
        .eq('source', orderTriggerSourceFor(order.source))
        .eq('action', 'flow')
        .limit(1)
        .maybeSingle()
      flowId = trigger?.action_payload?.flow_id as string | undefined
    }
    if (!flowId) throw new Error(`Nenhum gatilho "Pedido ${getPlatformLabel(order.source ?? 'shopify')} criado" configurado para esta conta`)

    if (options.respectShopifyTriggerSetting && !(await getOrderTriggersEnabled(order.source))) {
      return { order, skipped: true }
    }
    await executeOrderFlowForOrder(orderId, flowId, order)

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('fulfillment_orders')
      .update({
        confirmation_message_sent_at: new Date().toISOString(),
        confirmation_message_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single()
    if (updateError) throw new Error(updateError.message)
    return { order: updated }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao disparar gatilho de confirmação'
    await supabaseAdmin
      .from('fulfillment_orders')
      .update({
        confirmation_message_error: messageText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
    throw error
  }
}

// Nome neutro de plataforma para o mesmo gatilho.
export const runOrderTrigger = runShopifyOrderTrigger

export { maybeAutoSubmitConfirmedOrder }

function normalizeAndValidateItems(value: unknown, allowMissingSku = false): FulfillmentOrder['items'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Pedido precisa ter ao menos 1 item')
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Item de pedido inválido')
    const record = raw as Record<string, unknown>
    const sku = String(record.sku ?? '').trim()
    const name = String(record.name ?? '').trim()
    const quantity = Number(record.quantity)
    const unitPrice = Number(record.unit_price)
    if (!sku && !allowMissingSku) throw new Error('Item de pedido sem SKU')
    if (!name) throw new Error('Item de pedido sem nome')
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error('Quantidade do item inválida')
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Preço unitário do item inválido')
    const normalizedQuantity = Math.max(1, Math.trunc(quantity))
    const shopifyQuantity = Number(record.shopify_quantity)
    const lightfunnelsQuantity = Number(record.lightfunnels_quantity)
    const unitsPerPack = Number(record.units_per_pack)
    const packQuantitySource = String(record.pack_quantity_source ?? '')
    return {
      product_id: String(record.product_id ?? ''),
      shopify_product_id: record.shopify_product_id ? String(record.shopify_product_id) : undefined,
      shopify_variant_id: record.shopify_variant_id ? String(record.shopify_variant_id) : undefined,
      shopify_quantity: Number.isInteger(shopifyQuantity) && shopifyQuantity > 0 ? shopifyQuantity : undefined,
      lightfunnels_product_id: record.lightfunnels_product_id ? String(record.lightfunnels_product_id) : undefined,
      lightfunnels_variant_id: record.lightfunnels_variant_id ? String(record.lightfunnels_variant_id) : undefined,
      lightfunnels_quantity: Number.isInteger(lightfunnelsQuantity) && lightfunnelsQuantity > 0 ? lightfunnelsQuantity : undefined,
      units_per_pack: Number.isInteger(unitsPerPack) && unitsPerPack > 0 ? unitsPerPack : undefined,
      pack_quantity_source: ['sku', 'catalog', 'title', 'default'].includes(packQuantitySource)
        ? packQuantitySource as PackQuantitySource
        : undefined,
      sku,
      name,
      quantity: normalizedQuantity,
      unit_price: unitPrice,
      total: normalizedQuantity * unitPrice,
    }
  })
}

export async function updateConfirmationOrder(orderId: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let previousTotal: number | null = null
  let previousCountry: string | null = null

  if (body.country !== undefined) {
    const country = String(body.country ?? '').trim().toUpperCase()
    if (!country || country.length > 64) throw new Error('País de fulfillment inválido')

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('lead_number, country')
      .eq('id', orderId)
      .single()
    if (existingError || !existing) throw new Error('Pedido não encontrado')
    if (existing.lead_number) throw new Error('Pedido já foi enviado para o FenixCOD — o país não pode mais ser alterado')

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('fulfillment_integrations')
      .select('id')
      .eq('country', country)
      .eq('active', true)
      .maybeSingle()
    if (integrationError) throw new Error(`Falha ao validar integração para ${country}`)
    if (!integration) throw new Error(`Integração de fulfillment não configurada para ${country}`)

    previousCountry = String(existing.country)
    patch.country = country
  }

  if (body.commercial_status !== undefined) {
    if (!isCommercialStatus(body.commercial_status)) throw new Error('Status comercial inválido')
    patch.commercial_status = body.commercial_status
    patch.confirmation_status_updated_at = new Date().toISOString()
    patch.confirmed_at = body.commercial_status.startsWith('Confirmado') ? new Date().toISOString() : null
  }
  if (body.send_status !== undefined) {
    if (!isSendStatus(body.send_status)) throw new Error('Status de envio inválido')
    patch.send_status = body.send_status
  }
  if (body.delivery_status !== undefined) {
    if (!isDeliveryStatus(body.delivery_status)) throw new Error('Status de entrega inválido')
    patch.delivery_status = body.delivery_status
    patch.delivery_status_source = 'manual'
    patch.delivery_status_changed_at = new Date().toISOString()
  }
  if (body.assigned_instance_name !== undefined) {
    const assigned = String(body.assigned_instance_name ?? '').trim()
    patch.assigned_instance_name = assigned || null
    patch.instance_name = assigned
  }
  if (body.confirmation_trigger_state !== undefined) {
    const state = String(body.confirmation_trigger_state)
    if (!['pending', 'sent', 'failed'].includes(state)) {
      throw new Error('Estado do gatilho de confirmacao invalido')
    }
    if (state === 'sent') {
      patch.confirmation_message_sent_at = new Date().toISOString()
      patch.confirmation_message_error = null
    } else if (state === 'failed') {
      patch.confirmation_message_sent_at = null
      patch.confirmation_message_error = 'Marcado manualmente como falha'
    } else {
      patch.confirmation_message_sent_at = null
      patch.confirmation_message_error = null
    }
  }
  if (body.items !== undefined) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('lead_number, total, source')
      .eq('id', orderId)
      .single()
    if (existingError || !existing) throw new Error('Pedido não encontrado')
    if (existing.lead_number) throw new Error('Pedido já foi enviado para o FenixCOD — itens não podem mais ser alterados')

    const items = normalizeAndValidateItems(body.items, existing.source === 'shopify' || existing.source === 'lightfunnels')
    previousTotal = Number(existing.total)
    patch.items = items
    patch.total = items.reduce((sum, item) => sum + item.total, 0)
  }

  if (Object.keys(patch).length === 1) throw new Error('Nenhuma alteração válida informada')

  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .update(patch)
    .eq('id', orderId)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar pedido')

  if (patch.items !== undefined) {
    await recordOrderEvent(orderId, 'items_updated', {
      previous_total: previousTotal,
      new_total: patch.total,
      item_count: (patch.items as unknown[]).length,
    })
  }

  if (patch.country !== undefined) {
    await recordOrderEvent(orderId, 'country_updated', {
      previous_country: previousCountry,
      new_country: patch.country,
    })
  }

  if (body.confirmation_trigger_state !== undefined) {
    await recordOrderEvent(orderId, 'confirmation_trigger_state_updated', {
      state: body.confirmation_trigger_state,
    })
  }

  // A correção de país é uma preparação para o envio, não uma autorização
  // implícita para disparar uma operação externa no FenixCOD.
  const autoSubmit = body.commercial_status !== undefined
    ? await maybeAutoSubmitConfirmedOrder(orderId)
    : { submitted: false, order: data }
  scheduleLightfunnelsWriteback(data)
  return { order: autoSubmit.order ?? data, autoSubmit }
}

export async function updateAbandonedCheckout(checkoutId: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.recovery_status !== undefined) {
    if (!isAbandonedCheckoutStatus(body.recovery_status)) throw new Error('Status de recuperação inválido')
    patch.recovery_status = body.recovery_status
  }
  if (body.assigned_instance_name !== undefined) {
    const assigned = String(body.assigned_instance_name ?? '').trim()
    patch.assigned_instance_name = assigned || null
  }
  if (Object.keys(patch).length === 1) throw new Error('Nenhuma alteração válida informada')
  const { data, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .update(patch)
    .eq('id', checkoutId)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar checkout')
  return data
}

// Recuperação de carrinho abandonado é, por definição, sempre iniciada pela
// empresa — o cliente nunca escreveu sobre esse carrinho especificamente, e
// pode nunca ter escrito nada em até 24h. Numa conta cloud_api fora da
// janela, texto livre é rejeitado pela Meta; se houver um template de
// recuperação configurado na integração, usa ele em vez de tentar o texto
// livre fadado ao fracasso (mesma filosofia da Fase 4 no flow-engine).
export async function sendAbandonedCheckoutRecovery(checkoutId: string) {
  const { data: checkout, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .select('*')
    .eq('id', checkoutId)
    .single()
  if (error || !checkout) throw new Error(error?.message ?? 'Checkout não encontrado')
  if (checkout.is_simulation) throw new Error('Checkout de simulação não envia WhatsApp real')
  if (checkout.recovery_status === 'Não enviar') throw new Error('Checkout marcado para não enviar')
  const instanceName = String(checkout.assigned_instance_name ?? '')
  const phone = String(checkout.contact_phone ?? '')
  if (!instanceName) throw new Error('Checkout sem conta WhatsApp atribuída')
  if (!phone) throw new Error('Checkout sem telefone')

  const { conversationId, remoteJid } = await resolveConversationForOrder(
    instanceName,
    phone,
    String(checkout.customer_name || '')
  )

  let recoveryTemplateText: string | null = null
  let recoveryTemplateId: string | null = null
  let recoveryTemplateVariableMap: Record<string, string> = {}
  if (checkout.shopify_integration_id) {
    const { data: integrationRow } = await supabaseAdmin
      .from('shopify_integrations')
      .select('recovery_message_template, recovery_template_id, recovery_template_variable_map')
      .eq('id', checkout.shopify_integration_id)
      .maybeSingle()
    recoveryTemplateText = integrationRow?.recovery_message_template ?? null
    recoveryTemplateId = integrationRow?.recovery_template_id ?? null
    recoveryTemplateVariableMap = (integrationRow?.recovery_template_variable_map as Record<string, string> | null) ?? {}
  }

  const link = checkout.abandoned_checkout_url ? `\n${String(checkout.abandoned_checkout_url)}` : ''
  const freeTextMessage = interpolateTemplate(recoveryTemplateText || DEFAULT_RECOVERY_TEMPLATE, {
    nome: checkout.customer_name ? `, ${String(checkout.customer_name)}` : '',
    total: Number(checkout.total ?? 0).toFixed(2),
    currency: String(checkout.currency),
    link,
  })

  try {
    const provider = await getAccountProvider(instanceName)
    const withinWindow = provider !== 'cloud_api' || await isWithinMessagingWindow(conversationId)

    let waMessageId: string | null = null
    let persistedContent = freeTextMessage

    if (withinWindow) {
      const sent = await sendWhatsAppText({ instanceName, number: phone, text: freeTextMessage })
      waMessageId = sent.messageId
    } else if (recoveryTemplateId) {
      const template = await loadWhatsAppTemplateById(recoveryTemplateId)
      if (!template) throw new Error('Template de recuperação configurado não foi encontrado — sincronize os templates novamente')
      const rawValues = Array.from({ length: template.variable_count }, (_, i) => recoveryTemplateVariableMap[String(i + 1)] ?? '')
      const hasVariables = getMessagePlaceholders(...rawValues).length > 0
      const values = buildMessageTemplateValues(
        hasVariables
          ? { contact: { name: checkout.customer_name ?? null, number: phone }, customVariables: {} }
          : { contact: { name: null, number: phone }, customVariables: {} }
      )
      const parameters = rawValues.map((raw) => renderMessageTemplate(raw, values))
      persistedContent = interpolateTemplateBody(template.body_text, parameters)
      const result = await dispatchSendTemplate(instanceName, remoteJid, template.meta_template_name, template.language, parameters)
      waMessageId = result.waMessageId
    } else {
      throw new OutsideMessagingWindowError(conversationId)
    }

    await recordOutboundMessage({
      conversation_id: conversationId,
      wa_message_id: waMessageId,
      content: persistedContent,
      type: 'text',
      direction: 'outbound',
      status: 'sent',
      sender_type: 'ai',
    })
    await supabaseAdmin.from('conversations').update({
      last_message: persistedContent,
      last_message_at: new Date().toISOString(),
    }).eq('id', conversationId)

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({
        recovery_status: 'Enviado',
        whatsapp_sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkoutId)
      .select()
      .single()
    if (updateError) throw new Error(updateError.message)
    return { checkout: updated, messageId: waMessageId }
  } catch (error) {
    const messageText = error instanceof OutsideMessagingWindowError
      ? 'Fora da janela de 24h de atendimento e nenhum template de recuperação configurado — configure um template aprovado nas integrações do Shopify.'
      : (error instanceof Error ? error.message : 'Falha ao enviar recuperação')
    await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({
        last_error: messageText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkoutId)
    throw new Error(messageText)
  }
}

export async function syncShopifyData(options: {
  integrationId?: string
  limit?: number
  sendConfirmation?: boolean
  syncProducts?: boolean
} = {}) {
  const integrations = await listActiveShopifyIntegrations(options.integrationId)
  let importedOrders = 0
  let importedCheckouts = 0
  let importedProducts = 0
  const errors: Array<{ shopDomain: string; error: string }> = []

  for (const integration of integrations) {
    const client = shopifyClientFromIntegration(integration)
    try {
      const ordersResponse = await client.getRecentOrders({ limit: options.limit ?? 50 })
      for (const order of ordersResponse.orders ?? []) {
        await upsertShopifyOrder(integration, order, { sendConfirmation: options.sendConfirmation === true })
        importedOrders += 1
      }
    } catch (error) {
      errors.push({
        shopDomain: integration.shop_domain,
        error: `orders: ${error instanceof Error ? error.message : 'Erro inesperado'}`,
      })
    }
    try {
      const checkoutsResponse = await client.getAbandonedCheckouts({ limit: options.limit ?? 50 })
      for (const checkout of checkoutsResponse.checkouts ?? []) {
        // Sync é backfill manual: só agenda gatilhos quando o operador pediu
        // explicitamente os disparos (mesma regra dos pedidos).
        await upsertShopifyAbandonedCheckout(integration, checkout, {
          scheduleTriggers: options.sendConfirmation === true,
        })
        importedCheckouts += 1
      }
    } catch (error) {
      errors.push({
        shopDomain: integration.shop_domain,
        error: `checkouts: ${error instanceof Error ? error.message : 'Erro inesperado'}`,
      })
    }
    try {
      // Rascunhos abertos (apps de formulário COD). Loja conectada antes do
      // escopo read_draft_orders responde 403 — vira aviso, não derruba o sync.
      const draftsResponse = await client.getOpenDraftOrders({ limit: options.limit ?? 50 })
      for (const draft of draftsResponse.draft_orders ?? []) {
        await upsertShopifyDraftOrder(integration, draft, {
          scheduleTriggers: options.sendConfirmation === true,
        })
        importedCheckouts += 1
      }
    } catch (error) {
      errors.push({
        shopDomain: integration.shop_domain,
        error: `rascunhos: ${error instanceof Error ? error.message : 'Erro inesperado'}`,
      })
    }
    if (options.syncProducts ?? true) {
      try {
        const result = await syncShopifyProductsForIntegration(integration)
        importedProducts += result.imported
      } catch (error) {
        errors.push({
          shopDomain: integration.shop_domain,
          error: `products: ${error instanceof Error ? error.message : 'Erro inesperado'}`,
        })
      }
    }
  }

  return {
    integrations: integrations.length,
    importedOrders,
    importedCheckouts,
    importedProducts,
    errors,
  }
}


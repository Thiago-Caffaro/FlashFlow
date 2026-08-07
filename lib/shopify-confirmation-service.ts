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
import { executeFlow } from './flow-engine'
import { supabaseAdmin } from './supabase-admin'
import { SANDBOX_INSTANCE_NAME } from './sandbox'
import { normalizePhone } from './phone'
import { syncShopifyProductsForIntegration } from './shopify-products-service'
import { ISO_TO_FULFILLMENT_COUNTRY } from './fulfillment-countries'
import { enqueueShopifyOrderFlowJob } from './flow-jobs'
import { getShopifyTriggersEnabled } from './shopify-trigger-settings'
import { getDefaultShopifyOrderInstance } from './shopify-order-settings'
import {
  calculatePhysicalUnitPrice,
  resolvePackQuantity,
  type PackQuantitySource,
} from './shopify-pack-quantity'
import {
  SHOPIFY_INTEGRATION_PUBLIC_SELECT,
  decodeShopifyAdminToken,
  decodeShopifyWebhookSecret,
  shopifyClientFromIntegration,
  loadShopifyIntegrationForWebhook,
  listActiveShopifyIntegrations,
  type ShopifyIntegrationCredentialRow,
} from './shopify-integration-store'
import {
  ABANDONED_CHECKOUT_STATUSES,
  type AbandonedCheckoutStatus,
  type FulfillmentOrder,
} from '@/types'

export {
  SHOPIFY_INTEGRATION_PUBLIC_SELECT,
  decodeShopifyAdminToken,
  decodeShopifyWebhookSecret,
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

export async function assignConfirmationAccount(country: string): Promise<string | null> {
  const defaultInstanceName = await getDefaultShopifyOrderInstance()
  if (defaultInstanceName) return defaultInstanceName

  const normalizedCountry = country.trim().toUpperCase()
  if (!normalizedCountry) return null
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name')
    .eq('country', normalizedCountry)
    .eq('confirmation_enabled', true)
    .order('confirmation_priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Falha ao selecionar conta WhatsApp: ${error.message}`)
  return typeof data?.instance_name === 'string' ? data.instance_name : null
}

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
  options: { sendConfirmation?: boolean; isSimulation?: boolean; forceInstanceName?: string; forceConversationId?: string } = {}
) {
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
  const assignedInstanceName = options.forceInstanceName ?? await assignConfirmationAccount(country)
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

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Falha ao gravar pedido Shopify')
  }

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

  if (isNewOrder && options.sendConfirmation !== false && !existing?.confirmation_message_sent_at) {
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
    abandoned_checkout_url: nullableString(checkout.abandoned_checkout_url, checkout.web_url),
    total: numberValue(checkout.total_price, numberValue(checkout.current_total_price, 0)),
    currency: stringValue(checkout.currency, checkout.presentment_currency, 'EUR').toUpperCase(),
    raw_shopify_payload: checkout,
  }
}

export async function upsertShopifyAbandonedCheckout(
  integrationRow: ShopifyIntegrationCredentialRow,
  payload: unknown
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
  const assignedInstanceName = await assignConfirmationAccount(country)
  const mapped = mapShopifyAbandonedCheckoutPayload(payload, integration, assignedInstanceName)

  const { data: existing, error: existingError } = mapped.shopify_checkout_id
    ? await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .select('id, assigned_instance_name')
      .eq('shopify_integration_id', integration.id)
      .eq('shopify_checkout_id', mapped.shopify_checkout_id)
      .maybeSingle()
    : { data: null, error: null }
  if (existingError) throw new Error(`Falha ao consultar checkout Shopify: ${existingError.message}`)

  const existingAssigned = typeof existing?.assigned_instance_name === 'string' && existing.assigned_instance_name
    ? existing.assigned_instance_name
    : mapped.assigned_instance_name
  const patch = {
    ...mapped,
    assigned_instance_name: existingAssigned,
    updated_at: new Date().toISOString(),
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
        ...patch,
        recovery_status: 'Pendente',
        is_simulation: false,
      })
      .select()
      .single()

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Falha ao gravar checkout Shopify')
  }
  return result.data
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

  const remoteJid = `${phone}@s.whatsapp.net`
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

type OrderFlowOrder = {
  id: string
  customer_name: string | null
  contact_phone: string | null
  assigned_instance_name: string | null
  instance_name: string | null
  is_simulation: boolean
  shopify_deleted_at: string | null
  shopify_cancelled_at: string | null
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
  if (order.shopify_cancelled_at) throw new Error('Pedido foi cancelado no Shopify; fluxo bloqueado')
  if (order.shopify_deleted_at) throw new Error('Pedido foi excluído no Shopify; fluxo bloqueado')
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

export async function runOrderFlow(
  orderId: string,
  flowId: string,
  options: { paceAutomatedSend?: boolean } = {}
) {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, customer_name, contact_phone, assigned_instance_name, instance_name, is_simulation, shopify_deleted_at, shopify_cancelled_at')
    .eq('id', orderId)
    .single()
  if (error || !order) throw new Error(error?.message ?? 'Pedido não encontrado')
  return executeOrderFlowForOrder(orderId, flowId, order as OrderFlowOrder, options)
}

// Runs the "Pedido Shopify criado" flow trigger configured for the order's
// account. Replaces the old fixed-template confirmation message — there is
// no static fallback: if no trigger is configured, nothing is sent, by design.
export async function runShopifyOrderTrigger(
  orderId: string,
  flowIdOverride?: string,
  options: { respectShopifyTriggerSetting?: boolean } = {}
) {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, customer_name, contact_phone, assigned_instance_name, instance_name, is_simulation, shopify_deleted_at, shopify_cancelled_at')
    .eq('id', orderId)
    .single()
  if (error || !order) throw new Error(error?.message ?? 'Pedido não encontrado')
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
        .eq('source', 'shopify_order')
        .eq('action', 'flow')
        .limit(1)
        .maybeSingle()
      flowId = trigger?.action_payload?.flow_id as string | undefined
    }
    if (!flowId) throw new Error('Nenhum gatilho "Pedido Shopify criado" configurado para esta conta')

    if (options.respectShopifyTriggerSetting && !(await getShopifyTriggersEnabled())) {
      return { order, skipped: true }
    }
    await executeOrderFlowForOrder(orderId, flowId, order as OrderFlowOrder)

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
    const unitsPerPack = Number(record.units_per_pack)
    const packQuantitySource = String(record.pack_quantity_source ?? '')
    return {
      product_id: String(record.product_id ?? ''),
      shopify_product_id: record.shopify_product_id ? String(record.shopify_product_id) : undefined,
      shopify_variant_id: record.shopify_variant_id ? String(record.shopify_variant_id) : undefined,
      shopify_quantity: Number.isInteger(shopifyQuantity) && shopifyQuantity > 0 ? shopifyQuantity : undefined,
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

    const items = normalizeAndValidateItems(body.items, existing.source === 'shopify')
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

  let recoveryTemplateText: string | null = null
  if (checkout.shopify_integration_id) {
    const { data: integrationRow } = await supabaseAdmin
      .from('shopify_integrations')
      .select('recovery_message_template')
      .eq('id', checkout.shopify_integration_id)
      .maybeSingle()
    recoveryTemplateText = integrationRow?.recovery_message_template ?? null
  }

  const link = checkout.abandoned_checkout_url ? `\n${String(checkout.abandoned_checkout_url)}` : ''
  const message = interpolateTemplate(recoveryTemplateText || DEFAULT_RECOVERY_TEMPLATE, {
    nome: checkout.customer_name ? `, ${String(checkout.customer_name)}` : '',
    total: Number(checkout.total ?? 0).toFixed(2),
    currency: String(checkout.currency),
    link,
  })

  try {
    const sent = await sendWhatsAppText({ instanceName, number: phone, text: message })
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
    return { checkout: updated, messageId: sent.messageId }
  } catch (error) {
    await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({
        last_error: error instanceof Error ? error.message : 'Falha ao enviar recuperação',
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkoutId)
    throw error
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
        await upsertShopifyAbandonedCheckout(integration, checkout)
        importedCheckouts += 1
      }
    } catch (error) {
      errors.push({
        shopDomain: integration.shop_domain,
        error: `checkouts: ${error instanceof Error ? error.message : 'Erro inesperado'}`,
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


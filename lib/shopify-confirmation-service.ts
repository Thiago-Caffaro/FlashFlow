import 'server-only'
import { decryptSecret } from './ai-crypto'
import { sendWhatsAppText } from './whatsapp-text'
import { ShopifyClient, normalizeShopDomain } from './shopify-client'
import { submitFulfillmentOrder, FulfillmentOrderSubmissionError } from './fulfillment-service'
import { supabaseAdmin } from './supabase-admin'
import { SANDBOX_INSTANCE_NAME } from './sandbox'
import {
  ABANDONED_CHECKOUT_STATUSES,
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  SEND_STATUSES,
  type AbandonedCheckoutStatus,
  type CommercialStatus,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'

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
  items: Array<{ product_id: string; sku: string; name: string; quantity: number; unit_price: number; total: number }>
  total: number
  currency: string
}

type ConfirmationOrderRow = {
  id: string
  lead_number: string | null
  commercial_status: CommercialStatus
  send_status: SendStatus
  status: string
  is_simulation: boolean
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

export function isCommercialStatus(value: unknown): value is CommercialStatus {
  return (COMMERCIAL_STATUSES as readonly string[]).includes(String(value))
}

export function isSendStatus(value: unknown): value is SendStatus {
  return (SEND_STATUSES as readonly string[]).includes(String(value))
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(String(value))
}

export function isAbandonedCheckoutStatus(value: unknown): value is AbandonedCheckoutStatus {
  return (ABANDONED_CHECKOUT_STATUSES as readonly string[]).includes(String(value))
}

export function shouldSubmitToFenix(order: Pick<ConfirmationOrderRow, 'commercial_status' | 'send_status' | 'lead_number' | 'is_simulation'>): boolean {
  return order.commercial_status.startsWith('Confirmado') &&
    order.send_status === 'Pendente' &&
    !order.lead_number &&
    !order.is_simulation
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

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(number) ? number : fallback
}

function normalizeCountry(value: unknown, fallback: string): string {
  return stringValue(value, fallback).toUpperCase()
}

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

function normalizePhone(value: unknown): string {
  const raw = stringValue(value)
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 ? digits : raw
}

function customerName(order: Record<string, unknown>, shipping: Record<string, unknown>, billing: Record<string, unknown>) {
  const customer = asRecord(order.customer)
  const firstLast = [customer.first_name, customer.last_name].map((value) => stringValue(value)).filter(Boolean).join(' ')
  return stringValue(shipping.name, billing.name, firstLast, order.email, 'Cliente Shopify')
}

function mapLineItems(value: unknown): ShopifyOrderMappedFields['items'] {
  return asArray(value).map((entry, index) => {
    const item = asRecord(entry)
    const quantity = Math.max(1, Math.trunc(numberValue(item.quantity, 1)))
    const unitPrice = Math.max(0, numberValue(item.price, 0))
    const total = Math.max(0, numberValue(item.total_discount, 0) > unitPrice * quantity
      ? unitPrice * quantity
      : unitPrice * quantity - numberValue(item.total_discount, 0))
    const sku = stringValue(item.sku, item.variant_id, item.product_id, `SHOPIFY-${index + 1}`)
    return {
      product_id: stringValue(item.product_id, item.variant_id, sku),
      sku,
      name: stringValue(item.name, item.title, sku),
      quantity,
      unit_price: unitPrice,
      total,
    }
  })
}

export async function assignConfirmationAccount(country: string): Promise<string | null> {
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
  const total = numberValue(order.current_total_price, numberValue(order.total_price, items.reduce((sum, item) => sum + item.total, 0)))
  const currency = stringValue(order.currency, order.presentment_currency, 'EUR').toUpperCase()
  const phone = normalizePhone(order.phone ?? shipping.phone ?? billing.phone ?? asRecord(order.customer).phone)
  const orderName = nullableString(order.name)

  return {
    source: 'shopify',
    shopify_integration_id: integration.id,
    shopify_order_id: shopifyOrderId,
    shopify_order_name: orderName,
    shopify_order_number: nullableString(order.order_number, order.number),
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
  options: { sendConfirmation?: boolean; isSimulation?: boolean; forceInstanceName?: string } = {}
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
    .select('id, assigned_instance_name, commercial_status, send_status, delivery_status, confirmation_message_sent_at')
    .eq('shopify_integration_id', integration.id)
    .eq('shopify_order_id', mapped.shopify_order_id)
    .maybeSingle()
  if (existingError) throw new Error(`Falha ao consultar pedido Shopify: ${existingError.message}`)

  const now = new Date().toISOString()
  const existingAssigned = typeof existing?.assigned_instance_name === 'string' && existing.assigned_instance_name
    ? existing.assigned_instance_name
    : mapped.assigned_instance_name
  const patch = {
    ...mapped,
    assigned_instance_name: existingAssigned,
    instance_name: existingAssigned ?? '',
    updated_at: now,
  }

  const result = existing?.id
    ? await supabaseAdmin
      .from('fulfillment_orders')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single()
    : await supabaseAdmin
      .from('fulfillment_orders')
      .insert({
        ...patch,
        status: 'pending_operator',
        commercial_status: 'Não responde',
        send_status: 'Pendente',
        delivery_status: 'Não enviado',
        is_simulation: options.isSimulation ?? false,
      })
      .select()
      .single()

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Falha ao gravar pedido Shopify')
  }

  if (options.sendConfirmation !== false && !existing?.confirmation_message_sent_at) {
    await sendOrderConfirmationMessage(result.data.id).catch((error) => {
      console.error('[shopify-confirmation] failed to send confirmation:', error)
    })
  }

  return result.data
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

const DEFAULT_CONFIRMATION_TEMPLATE =
  'Olá, {{nome}}!\nRecebemos seu pedido {{pedido}} no valor de {{currency}} {{total}}.\nResponda esta mensagem para confirmar a entrega e finalizar o envio.'

const DEFAULT_RECOVERY_TEMPLATE =
  'Olá{{nome}}!\nSeu carrinho de {{currency}} {{total}} ainda está disponível.{{link}}\nResponda esta mensagem se quiser ajuda para finalizar.'

export async function sendOrderConfirmationMessage(orderId: string) {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, order_number, shopify_order_name, customer_name, contact_phone, assigned_instance_name, instance_name, total, currency, is_simulation, shopify_integration_id')
    .eq('id', orderId)
    .single()
  if (error || !order) throw new Error(error?.message ?? 'Pedido não encontrado')
  const instanceName = String(order.assigned_instance_name || order.instance_name || '')
  const isSandboxOrder = instanceName === SANDBOX_INSTANCE_NAME
  if (order.is_simulation && !isSandboxOrder) throw new Error('Pedido de simulação não envia WhatsApp real')
  const phone = String(order.contact_phone || '')
  if (!instanceName) throw new Error('Pedido sem conta WhatsApp atribuída')
  if (!phone) throw new Error('Pedido sem telefone para confirmação')

  let templateText: string | null = null
  if (order.shopify_integration_id) {
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('confirmation_message_template')
      .eq('id', order.shopify_integration_id)
      .maybeSingle()
    templateText = integration?.confirmation_message_template ?? null
  }

  const message = interpolateTemplate(templateText || DEFAULT_CONFIRMATION_TEMPLATE, {
    nome: String(order.customer_name || ''),
    pedido: String(order.shopify_order_name || order.order_number),
    total: Number(order.total ?? 0).toFixed(2),
    currency: String(order.currency),
  })

  try {
    const sent = await sendWhatsAppText({ instanceName, number: phone, text: message })
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
    return { order: updated, messageId: sent.messageId }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao enviar confirmação'
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

export async function maybeAutoSubmitConfirmedOrder(orderId: string) {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, lead_number, commercial_status, send_status, status, is_simulation')
    .eq('id', orderId)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Pedido não encontrado')
  const order = data as ConfirmationOrderRow
  if (!shouldSubmitToFenix(order)) return { submitted: false, order }

  try {
    const submittedOrder = await submitFulfillmentOrder(orderId)
    return { submitted: true, order: submittedOrder }
  } catch (error) {
    if (error instanceof FulfillmentOrderSubmissionError) {
      return {
        submitted: false,
        order: error.order ?? order,
        error: error.message,
        submissionStatus: error.submissionStatus,
      }
    }
    return {
      submitted: false,
      order,
      error: error instanceof Error ? error.message : 'Falha ao enviar ao FenixCOD',
    }
  }
}

export async function updateConfirmationOrder(orderId: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

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
  }
  if (body.assigned_instance_name !== undefined) {
    const assigned = String(body.assigned_instance_name ?? '').trim()
    patch.assigned_instance_name = assigned || null
    patch.instance_name = assigned
  }

  if (Object.keys(patch).length === 1) throw new Error('Nenhuma alteração válida informada')

  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .update(patch)
    .eq('id', orderId)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar pedido')

  const autoSubmit = await maybeAutoSubmitConfirmedOrder(orderId)
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
} = {}) {
  const integrations = await listActiveShopifyIntegrations(options.integrationId)
  let importedOrders = 0
  let importedCheckouts = 0
  const errors: Array<{ shopDomain: string; error: string }> = []

  for (const integration of integrations) {
    const client = shopifyClientFromIntegration(integration)
    try {
      const ordersResponse = await client.getRecentOrders({ limit: options.limit ?? 50 })
      for (const order of ordersResponse.orders ?? []) {
        await upsertShopifyOrder(integration, order, { sendConfirmation: options.sendConfirmation })
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
  }

  return {
    integrations: integrations.length,
    importedOrders,
    importedCheckouts,
    errors,
  }
}

export async function createSimulationData(body: Record<string, unknown> = {}) {
  const country = normalizeCountry(body.country, 'PORTUGAL')
  const assigned = await assignConfirmationAccount(country)
  const marker = `simulation-${Date.now()}`
  const now = new Date().toISOString()
  const orderId = `sim-${Date.now()}`
  const total = Math.max(1, numberValue(body.total, 39.9))
  const orderPayload = {
    id: orderId,
    name: `SIM-${orderId}`,
    order_number: orderId,
    email: nullableString(body.email) ?? 'cliente.simulado@example.com',
    phone: nullableString(body.phone) ?? '+351900000000',
    currency: 'EUR',
    total_price: String(total),
    shipping_address: {
      name: nullableString(body.customer_name) ?? 'Cliente Simulado',
      address1: 'Rua de Teste 123',
      city: 'Lisboa',
      province: 'Lisboa',
      zip: '1000-001',
      country_code: country,
      phone: nullableString(body.phone) ?? '+351900000000',
    },
    line_items: [{
      product_id: 'simulation-product',
      sku: nullableString(body.sku) ?? 'SIM-SKU',
      name: 'Produto Simulado',
      quantity: 1,
      price: String(total),
    }],
  }

  const mappedOrder = await mapShopifyOrderPayload(orderPayload, {
    id: '',
    shopDomain: 'simulation.local',
    defaultCountry: country,
  }, assigned)

  const { data: order, error: orderError } = await supabaseAdmin
    .from('fulfillment_orders')
    .insert({
      ...mappedOrder,
      shopify_integration_id: null,
      status: 'pending_operator',
      commercial_status: 'Não responde',
      send_status: 'Pendente',
      delivery_status: 'Não enviado',
      is_simulation: true,
      simulation_marker: marker,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()
  if (orderError || !order) throw new Error(orderError?.message ?? 'Falha ao criar pedido de simulação')

  const checkoutPayload = {
    id: `${orderId}-checkout`,
    token: `${orderId}-token`,
    email: orderPayload.email,
    phone: orderPayload.phone,
    currency: 'EUR',
    total_price: String(total),
    abandoned_checkout_url: 'https://simulation.local/checkouts/test',
    shipping_address: orderPayload.shipping_address,
  }
  const checkoutMapped = mapShopifyAbandonedCheckoutPayload(checkoutPayload, {
    id: '',
    shopDomain: 'simulation.local',
    defaultCountry: country,
  }, assigned)
  const { data: checkout, error: checkoutError } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .insert({
      ...checkoutMapped,
      shopify_integration_id: null,
      recovery_status: 'Pendente',
      is_simulation: true,
      simulation_marker: marker,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()
  if (checkoutError || !checkout) throw new Error(checkoutError?.message ?? 'Falha ao criar checkout de simulação')

  return { order, checkout, marker }
}

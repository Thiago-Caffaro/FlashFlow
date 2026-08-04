import 'server-only'
import { decryptSecret, encryptSecret } from './ai-crypto'
import {
  CreateFulfillmentLead,
  FulfillmentApiError,
  FulfillmentClient,
  FulfillmentCredentials,
  FulfillmentEnvironment,
} from './fulfillment-client'
import { normalizeExternalFulfillmentLeads } from './fulfillment-leads'
import { supabaseAdmin } from './supabase-admin'
import type { ExternalFulfillmentLead } from '@/types'

type IntegrationRow = {
  country: string
  environment: FulfillmentEnvironment
  encrypted_email: string
  email_iv: string
  email_auth_tag: string
  encrypted_password: string
  password_iv: string
  password_auth_tag: string
  encrypted_token: string | null
  token_iv: string | null
  token_auth_tag: string | null
  token_expires_at: string | null
}

type FulfillmentProductRow = {
  id: string
  sku: string
  name: string
  price: number | string
  currency: string
  active: boolean
}

type FulfillmentOrderItem = {
  product_id: string
  shopify_product_id?: string
  shopify_variant_id?: string
  sku: string
  name: string
  quantity: number
  unit_price: number
  total: number
}

type FulfillmentOrderRow = {
  id: string
  order_number: string
  lead_number: string | null
  instance_name: string
  country: string
  conversation_id: string | null
  contact_phone: string
  customer_name: string
  email: string | null
  address: string
  city: string
  province: string
  zipcode: string
  payment_type: 'COD' | 'PREPAID'
  items: FulfillmentOrderItem[] | unknown
  total: number | string
  currency: string
  status: string
  send_status?: string | null
  shopify_order_name?: string | null
  shopify_integration_id?: string | null
  raw_shopify_payload?: Record<string, unknown> | null
  source?: 'manual' | 'shopify'
  is_simulation?: boolean | null
}

export interface OrderInput {
  instanceName: string
  conversationId?: string | null
  customerName: string
  contactPhone: string
  email?: string | null
  address: string
  city: string
  province: string
  zipcode: string
  paymentType: 'COD' | 'PREPAID'
  items: Array<{ productId: string; quantity: number }>
  isSimulation?: boolean
}

export class FulfillmentOrderSubmissionError extends Error {
  constructor(
    message: string,
    public readonly submissionStatus: 'unknown' | 'failed',
    public readonly order?: unknown
  ) {
    super(message)
    this.name = 'FulfillmentOrderSubmissionError'
  }
}

function decodeCredentials(row: IntegrationRow): FulfillmentCredentials {
  return {
    email: decryptSecret(row.encrypted_email, row.email_iv, row.email_auth_tag),
    password: decryptSecret(row.encrypted_password, row.password_iv, row.password_auth_tag),
    environment: row.environment,
  }
}

function tokenFromRow(row: IntegrationRow): string | null {
  if (!row.encrypted_token || !row.token_iv || !row.token_auth_tag || !row.token_expires_at) return null
  if (new Date(row.token_expires_at).getTime() <= Date.now() + 5 * 60 * 1000) return null
  return decryptSecret(row.encrypted_token, row.token_iv, row.token_auth_tag)
}

async function loadIntegration(country: string): Promise<IntegrationRow> {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_integrations')
    .select('*')
    .eq('country', country)
    .eq('active', true)
    .single()
  if (error || !data) throw new Error(`Integração de fulfillment não configurada para ${country}`)
  return data as IntegrationRow
}

export async function getFulfillmentClient(country: string): Promise<FulfillmentClient> {
  const row = await loadIntegration(country)
  const credentials = decodeCredentials(row)
  let cachedToken = tokenFromRow(row)

  return new FulfillmentClient(credentials, async (forceRefresh = false) => {
    if (forceRefresh) cachedToken = null
    if (cachedToken) return cachedToken
    const login = await FulfillmentClient.login(credentials)
    const encrypted = encryptSecret(login.token)
    const { error } = await supabaseAdmin
      .from('fulfillment_integrations')
      .update({
        encrypted_token: encrypted.encrypted_key,
        token_iv: encrypted.iv,
        token_auth_tag: encrypted.auth_tag,
        token_expires_at: login.expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('country', country)
    if (error) throw new Error(`Falha ao armazenar token: ${error.message}`)
    cachedToken = login.token
    return login.token
  })
}

export async function getCountryForInstance(instanceName: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('country')
    .eq('instance_name', instanceName)
    .single()
  if (error || !data?.country) throw new Error('A conta WhatsApp não possui país configurado')
  return String(data.country)
}

export async function listExternalFulfillmentLeads(country: string): Promise<ExternalFulfillmentLead[]> {
  const normalizedCountry = country.trim().toUpperCase()
  if (!normalizedCountry) throw new Error('País obrigatório')
  const client = await getFulfillmentClient(normalizedCountry)
  const response = await client.getLeads(normalizedCountry)
  return normalizeExternalFulfillmentLeads(response, normalizedCountry)
}

export async function createFulfillmentOrder(input: OrderInput) {
  const country = await getCountryForInstance(input.instanceName)
  if (!input.items.length) throw new Error('Pedido sem itens')

  const productIds = [...new Set(input.items.map((item) => item.productId).filter(Boolean))]
  if (!productIds.length) throw new Error('Pedido sem produtos configurados')

  const { data: products, error: productError } = await supabaseAdmin
    .from('fulfillment_products')
    .select('id, sku, name, price, currency, active')
    .eq('country', country)
    .in('id', productIds)
  if (productError) throw new Error(productError.message)
  const productRows = (products ?? []) as FulfillmentProductRow[]
  if (productRows.length !== productIds.length || productRows.some((product) => !product.active)) {
    throw new Error('Um ou mais produtos não estão disponíveis para este país')
  }

  const resolvedItems = input.items.map((item) => {
    const product = productRows.find((candidate) => candidate.id === item.productId)
    if (!product) throw new Error('Um ou mais produtos não estão disponíveis para este país')
    const quantity = Math.max(1, Math.trunc(item.quantity))
    const unitPrice = Number(product.price)
    return {
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      total: unitPrice * quantity,
    }
  })
  const total = resolvedItems.reduce((sum, item) => sum + item.total, 0)
  const currency = String(productRows[0].currency)
  const orderNumber = `FF-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const { data: order, error: orderError } = await supabaseAdmin
    .from('fulfillment_orders')
    .insert({
      order_number: orderNumber,
      instance_name: input.instanceName,
      country,
      conversation_id: input.conversationId ?? null,
      contact_phone: input.contactPhone,
      customer_name: input.customerName,
      email: input.email ?? null,
      address: input.address,
      city: input.city,
      province: input.province,
      zipcode: input.zipcode,
      payment_type: input.paymentType,
      items: resolvedItems,
      total,
      currency,
      status: 'pending_operator',
      is_simulation: input.isSimulation ?? false,
    })
    .select()
    .single()
  if (orderError || !order) throw new Error(orderError?.message ?? 'Falha ao criar pedido local')

  await recordOrderEvent(order.id, 'pending_operator', { order_number: orderNumber })
  return order
}

export async function submitFulfillmentOrder(orderId: string) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('fulfillment_orders')
    .update({
      status: 'submitting',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .is('lead_number', null)
    .eq('is_simulation', false)
    .in('status', ['pending_operator', 'failed'])
    .select('*')
    .single()

  if (orderError || !order) {
    const { data: current } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('id, lead_number, status, is_simulation')
      .eq('id', orderId)
      .maybeSingle()

    if (!current) throw new Error('Pedido não encontrado')
    if (current.lead_number) throw new Error('Pedido já foi enviado para o FenixCOD')
    if ((current as { is_simulation?: boolean }).is_simulation) throw new Error('Pedido de simulação não pode ser enviado ao FenixCOD')
    if (current.status === 'cancelled') throw new Error('Pedido local já foi cancelado')
    if (current.status === 'unknown') throw new Error('Pedido está com envio incerto; verifique no FenixCOD antes de reenviar')
    throw new Error('Pedido não está pendente para envio')
  }

  const orderRow = order as FulfillmentOrderRow
  await recordOrderEvent(orderRow.id, 'submitting', { order_number: orderRow.order_number })

  try {
    const resolvedItems = await resolveOrderItemsForSubmission(orderRow)
    const client = await getFulfillmentClient(orderRow.country)
    const payload = buildLeadPayload(orderRow, resolvedItems)
    const external = await client.createLead(payload)
    const leadNumber = findLeadNumber(external)
    const { data: updated } = await supabaseAdmin
      .from('fulfillment_orders')
      .update({
        items: resolvedItems,
        lead_number: leadNumber,
        status: 'created',
        send_status: 'Enviado',
        external_snapshot: external,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderRow.id)
      .select()
      .single()
    await recordOrderEvent(orderRow.id, 'created', { lead_number: leadNumber })
    return updated
  } catch (error) {
    const message = submissionErrorMessage(error)
    const uncertain = isTimeoutError(error)
    const status = uncertain ? 'unknown' : 'failed'
    const { data: updated } = await supabaseAdmin.from('fulfillment_orders').update({
      status,
      send_status: 'Pendente',
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', orderRow.id).select().single()
    await recordOrderEvent(orderRow.id, status, { error: message })
    throw new FulfillmentOrderSubmissionError(message, status, updated)
  }
}

export async function refreshFulfillmentOrder(orderId: string) {
  const { syncFulfillmentDeliveryOrder } = await import('./fulfillment-delivery-sync')
  return syncFulfillmentDeliveryOrder(orderId)
}

export async function cancelFulfillmentOrder(orderId: string) {
  const { data: order, error } = await supabaseAdmin.from('fulfillment_orders').select('*').eq('id', orderId).single()
  if (error || !order) throw new Error('Pedido não encontrado')
  if (!order.lead_number) throw new Error('Pedido ainda não possui lead_number')
  const client = await getFulfillmentClient(order.country)
  const snapshot = await client.deleteLead(order.lead_number)
  const { data: updated } = await supabaseAdmin.from('fulfillment_orders').update({
    status: 'cancelled',
    external_snapshot: snapshot,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId).select().single()
  await recordOrderEvent(orderId, 'cancelled', { lead_number: order.lead_number })
  return updated
}

export async function cancelLocalFulfillmentOrder(orderId: string) {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('id, lead_number, status')
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Pedido não encontrado')
  if (order.lead_number) throw new Error('Pedido já foi enviado para o FenixCOD')
  if (order.status !== 'pending_operator') {
    throw new Error('Somente pedidos locais pendentes podem ser cancelados sem ação externa')
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('fulfillment_orders')
    .update({
      status: 'cancelled',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single()
  if (updateError || !updated) throw new Error(updateError?.message ?? 'Falha ao cancelar pedido local')
  await recordOrderEvent(orderId, 'cancelled_local', { previous_status: order.status })
  return updated
}

export async function recordOrderEvent(orderId: string, eventType: string, payload: unknown) {
  await supabaseAdmin.from('fulfillment_order_events').insert({
    order_id: orderId,
    event_type: eventType,
    payload,
  })
}

function buildLeadPayload(order: FulfillmentOrderRow, items = normalizeOrderItems(order.items)): CreateFulfillmentLead {
  return {
    name_costumer: order.customer_name,
    mobile: order.contact_phone,
    province: order.province,
    zipcod: order.zipcode,
    city: order.city,
    address: order.address,
    total: Number(order.total),
    payment_type: order.payment_type,
    country: order.country,
    email: order.email,
    order_number: order.shopify_order_name || order.order_number,
    items: items.map((item) => ({ sku: item.sku, quantity: item.quantity, total: item.total })),
  }
}

function normalizeOrderItems(value: unknown): FulfillmentOrderItem[] {
  if (!Array.isArray(value)) throw new Error('Pedido local sem itens válidos')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Pedido local sem itens válidos')
    const record = item as Record<string, unknown>
    const sku = String(record.sku ?? '').trim()
    const quantity = Number(record.quantity)
    const total = Number(record.total)
    if (!Number.isFinite(quantity) || !Number.isFinite(total)) {
      throw new Error('Pedido local sem itens válidos')
    }
    return {
      product_id: String(record.product_id ?? ''),
      shopify_product_id: record.shopify_product_id ? String(record.shopify_product_id) : undefined,
      shopify_variant_id: record.shopify_variant_id ? String(record.shopify_variant_id) : undefined,
      sku,
      name: String(record.name ?? sku),
      quantity: Math.max(1, Math.trunc(quantity)),
      unit_price: Number(record.unit_price ?? total),
      total,
    }
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isShopifyIdentifierSku(sku: string, productId: string, variantId: string): boolean {
  return Boolean(sku) && (sku === productId || sku === variantId || sku.startsWith('SHOPIFY-'))
}

async function resolveOrderItemsForSubmission(order: FulfillmentOrderRow): Promise<FulfillmentOrderItem[]> {
  const items = normalizeOrderItems(order.items)
  if (order.source !== 'shopify' || !order.shopify_integration_id) {
    if (items.some((item) => !item.sku)) throw new Error('Pedido local possui item sem SKU')
    return items
  }

  const rawLineItems = Array.isArray(order.raw_shopify_payload?.line_items)
    ? order.raw_shopify_payload.line_items.map(asRecord)
    : []
  const variantIds = [...new Set([
    ...items.map((item) => item.shopify_variant_id).filter((id): id is string => Boolean(id)),
    ...rawLineItems.map((item) => String(item.variant_id ?? '')).filter(Boolean),
  ])]

  let catalogByVariantId = new Map<string, string>()
  if (variantIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('shopify_products')
      .select('shopify_variant_id, sku')
      .eq('shopify_integration_id', order.shopify_integration_id)
      .in('shopify_variant_id', variantIds)
    if (error) throw new Error(`Falha ao validar os SKUs do Shopify: ${error.message}`)
    catalogByVariantId = new Map(
      (data ?? []).map((row) => [String(row.shopify_variant_id ?? ''), String(row.sku ?? '').trim()])
    )
  }

  return items.map((item, index) => {
    const rawItem = rawLineItems.find((candidate) => {
      const variantId = String(candidate.variant_id ?? '')
      const productId = String(candidate.product_id ?? '')
      return Boolean(
        (item.shopify_variant_id && variantId === item.shopify_variant_id) ||
        (item.shopify_product_id && productId === item.shopify_product_id) ||
        item.product_id === variantId ||
        item.product_id === productId
      )
    }) ?? rawLineItems[index] ?? {}
    const productId = item.shopify_product_id || String(rawItem.product_id ?? '')
    const variantId = item.shopify_variant_id || String(rawItem.variant_id ?? '')
    const rawSku = String(rawItem.sku ?? '').trim()
    const storedSku = item.sku.trim()
    const catalogSku = catalogByVariantId.get(variantId)?.trim() ?? ''
    const currentSku = isShopifyIdentifierSku(storedSku, productId, variantId) ? '' : storedSku
    const sku = catalogSku || rawSku || currentSku

    if (!sku) {
      throw new Error(
        `O produto "${item.name}" não possui SKU válido no Shopify. ` +
        'Cadastre no Shopify o mesmo SKU usado no FenixCOD, sincronize os produtos e tente novamente.'
      )
    }

    return {
      ...item,
      product_id: variantId || item.product_id,
      shopify_product_id: productId || undefined,
      shopify_variant_id: variantId || undefined,
      sku,
    }
  })
}

function submissionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha desconhecida'
  const match = message.match(/Product Not Found\s+(.+)/i)
  if (!match) return message
  const sku = match[1].trim()
  return `SKU "${sku}" não encontrado no FenixCOD. ` +
    'Use no Shopify exatamente o mesmo SKU cadastrado no FenixCOD, sincronize os produtos e tente novamente.'
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof FulfillmentApiError && error.status === 504) return true
  return error instanceof Error && error.message.toLowerCase().includes('timeout')
}

function findLeadNumber(response: Record<string, unknown>): string | null {
  const data = response.data as Record<string, unknown> | undefined
  const lead = response.lead as Record<string, unknown> | undefined
  return String(
    response.lead_number ??
    response.leadNumber ??
    response.lead_no ??
    response.leadNo ??
    response.number ??
    response.id ??
    data?.lead_number ??
    data?.leadNumber ??
    data?.lead_no ??
    data?.leadNo ??
    data?.number ??
    data?.id ??
    lead?.lead_number ??
    lead?.leadNumber ??
    lead?.lead_no ??
    lead?.leadNo ??
    lead?.number ??
    lead?.id ??
    ''
  ) || null
}

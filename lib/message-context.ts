import 'server-only'
import type { Conversation, FulfillmentOrder, ShopifyAbandonedCheckout, ShopifyProduct } from '@/types'
import type { CatalogProductName, MessageTemplateContext } from './message-template'
import { lightfunnelsCatalogKey, messageUsesCheckoutVariables, messageUsesOrderVariables, messageUsesProductVariables } from './message-template'
import { normalizePhone } from './phone'
import { supabaseAdmin } from './supabase-admin'

export class OrderContextPendingError extends Error {
  constructor(message = 'Pedido ainda nao esta disponivel no banco local') {
    super(message)
    this.name = 'OrderContextPendingError'
  }
}

async function loadConversation(conversationId: string): Promise<Conversation> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()
  if (error || !data) {
    throw new Error(error?.message ?? 'Conversa nao encontrada')
  }
  return data as Conversation
}

async function loadOrder(
  instanceName: string,
  conversation: Conversation,
  orderId?: string
): Promise<FulfillmentOrder | null> {
  if (orderId) {
    const { data, error } = await supabaseAdmin
      .from('fulfillment_orders')
      .select('*')
      .eq('id', orderId)
      .is('shopify_deleted_at', null)
      .is('lightfunnels_archived_at', null)
      .maybeSingle()
    if (error) throw new Error(`Falha ao consultar pedido: ${error.message}`)
    if (!data) return null
    const orderInstance = String(data.assigned_instance_name || data.instance_name || '')
    if (orderInstance !== instanceName) {
      throw new Error('Pedido nao pertence a esta conta WhatsApp')
    }
    return data as FulfillmentOrder
  }

  const byConversation = await supabaseAdmin
    .from('fulfillment_orders')
    .select('*')
    .eq('conversation_id', conversation.id)
    .is('shopify_deleted_at', null)
    .is('lightfunnels_archived_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byConversation.error) {
    throw new Error(`Falha ao consultar pedido da conversa: ${byConversation.error.message}`)
  }
  if (byConversation.data) return byConversation.data as FulfillmentOrder

  const phone = normalizePhone(conversation.contact_phone || conversation.wa_id)
  if (!phone) return null
  const byPhone = await supabaseAdmin
    .from('fulfillment_orders')
    .select('*')
    .eq('contact_phone', phone)
    .is('shopify_deleted_at', null)
    .is('lightfunnels_archived_at', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (byPhone.error) {
    throw new Error(`Falha ao consultar pedido pelo telefone: ${byPhone.error.message}`)
  }
  const matchingOrder = (byPhone.data ?? []).find((row) => (
    row.instance_name === instanceName || row.assigned_instance_name === instanceName
  ))
  return matchingOrder as FulfillmentOrder | null
}

// Mesmo desenho do loadOrder: o checkout exato quando o fluxo nasceu do
// gatilho de carrinho; senão (ex: fluxo retomado por um caminho que perdeu o
// id), o checkout mais recente desse telefone nesta conta.
async function loadCheckout(
  instanceName: string,
  conversation: Conversation,
  checkoutId?: string
): Promise<ShopifyAbandonedCheckout | null> {
  if (checkoutId) {
    const { data, error } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .select('*')
      .eq('id', checkoutId)
      .maybeSingle()
    if (error) throw new Error(`Falha ao consultar carrinho: ${error.message}`)
    if (!data) return null
    if (data.assigned_instance_name !== instanceName) {
      throw new Error('Carrinho nao pertence a esta conta WhatsApp')
    }
    return data as ShopifyAbandonedCheckout
  }

  const phone = normalizePhone(conversation.contact_phone || conversation.wa_id)
  if (!phone) return null
  const { data, error } = await supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .select('*')
    .eq('contact_phone', phone)
    .eq('assigned_instance_name', instanceName)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar carrinho pelo telefone: ${error.message}`)
  return data as ShopifyAbandonedCheckout | null
}

export async function resolveFlowOrder(input: {
  instanceName: string
  conversationId: string
  orderId?: string
}): Promise<FulfillmentOrder> {
  const conversation = await loadConversation(input.conversationId)
  if (conversation.instance_name !== input.instanceName) {
    throw new Error('Conversa nao pertence a esta conta WhatsApp')
  }

  const order = await loadOrder(input.instanceName, conversation, input.orderId)
  if (!order) throw new OrderContextPendingError()
  return order
}

async function loadProducts(
  order: FulfillmentOrder,
  required: boolean
): Promise<Map<string, CatalogProductName>> {
  const result = new Map<string, CatalogProductName>()
  if (!required) return result

  const variantIds = [...new Set(order.items
    .map((item) => item.shopify_variant_id)
    .filter((id): id is string => Boolean(id)))]
  if (variantIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('shopify_products')
      .select('*')
      .in('shopify_variant_id', variantIds)
    if (error) throw new Error(`Falha ao consultar catalogo local: ${error.message}`)
    for (const product of (data ?? []) as ShopifyProduct[]) {
      if (product.shopify_variant_id) result.set(product.shopify_variant_id, product)
    }
  }

  const lightfunnelsVariantIds = [...new Set(order.items
    .map((item) => item.lightfunnels_variant_id)
    .filter((id): id is string => Boolean(id)))]
  if (lightfunnelsVariantIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('lightfunnels_products')
      .select('lf_variant_id, title')
      .in('lf_variant_id', lightfunnelsVariantIds)
    if (error) throw new Error(`Falha ao consultar catalogo local: ${error.message}`)
    for (const product of data ?? []) {
      if (product.lf_variant_id) result.set(lightfunnelsCatalogKey(String(product.lf_variant_id)), { title: String(product.title ?? '') })
    }
  }
  return result
}

async function loadCustomVariables(instanceName: string): Promise<Record<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('message_variables')
    .select('key, value')
    .eq('instance_name', instanceName)
  if (error) throw new Error(`Falha ao consultar variaveis personalizadas: ${error.message}`)
  return Object.fromEntries((data ?? []).map((row) => [String(row.key), String(row.value)]))
}

export async function resolveMessageTemplateContext(input: {
  instanceName: string
  conversationId: string
  remoteJid: string
  orderId?: string
  checkoutId?: string
  templates: Array<string | null | undefined>
}): Promise<MessageTemplateContext> {
  const conversation = await loadConversation(input.conversationId)
  if (conversation.instance_name !== input.instanceName) {
    throw new Error('Conversa nao pertence a esta conta WhatsApp')
  }

  const needsOrder = messageUsesOrderVariables(...input.templates)
  const order = needsOrder
    ? await loadOrder(input.instanceName, conversation, input.orderId)
    : null
  if (needsOrder && !order) throw new OrderContextPendingError()

  // Diferente do pedido, o checkout é gravado antes do job existir — se ele
  // não está no banco, esperar não resolve.
  const needsCheckout = messageUsesCheckoutVariables(...input.templates)
  const checkout = needsCheckout
    ? await loadCheckout(input.instanceName, conversation, input.checkoutId)
    : null
  if (needsCheckout && !checkout) {
    throw new Error('Nenhum carrinho abandonado encontrado para esta conversa')
  }

  return {
    contact: {
      name: conversation.contact_name,
      number: conversation.contact_phone || input.remoteJid,
    },
    order,
    checkout,
    productsByVariantId: order
      ? await loadProducts(order, messageUsesProductVariables(...input.templates))
      : new Map(),
    customVariables: await loadCustomVariables(input.instanceName),
  }
}

import 'server-only'
import type { Conversation, FulfillmentOrder, ShopifyProduct } from '@/types'
import type { MessageTemplateContext } from './message-template'
import { messageUsesOrderVariables, messageUsesProductVariables } from './message-template'
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
): Promise<Map<string, ShopifyProduct>> {
  const result = new Map<string, ShopifyProduct>()
  if (!required) return result

  const variantIds = [...new Set(order.items
    .map((item) => item.shopify_variant_id)
    .filter((id): id is string => Boolean(id)))]
  if (variantIds.length === 0) return result

  const { data, error } = await supabaseAdmin
    .from('shopify_products')
    .select('*')
    .in('shopify_variant_id', variantIds)
  if (error) throw new Error(`Falha ao consultar catalogo local: ${error.message}`)
  for (const product of (data ?? []) as ShopifyProduct[]) {
    if (product.shopify_variant_id) result.set(product.shopify_variant_id, product)
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

  return {
    contact: {
      name: conversation.contact_name,
      number: conversation.contact_phone || input.remoteJid,
    },
    order,
    productsByVariantId: order
      ? await loadProducts(order, messageUsesProductVariables(...input.templates))
      : new Map(),
    customVariables: await loadCustomVariables(input.instanceName),
  }
}

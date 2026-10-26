import type { OrderSource, TriggerSource } from '@/types'

// Leitura de pedido independente da plataforma de origem (Shopify,
// Lightfunnels, manual). Quem consome fulfillment_orders usa estes helpers em
// vez de olhar shopify_* / lightfunnels_* direto. Sem 'server-only': também
// roda nos componentes.

export interface OrderPlatformFields {
  source?: OrderSource | null
  order_number?: string | null
  shopify_order_name?: string | null
  shopify_deleted_at?: string | null
  shopify_cancelled_at?: string | null
  shopify_financial_status?: string | null
  lightfunnels_order_name?: string | null
  lightfunnels_archived_at?: string | null
  lightfunnels_cancelled_at?: string | null
  lightfunnels_financial_status?: string | null
}

export const ORDER_PLATFORM_LABELS: Record<OrderSource, string> = {
  manual: 'Manual',
  shopify: 'Shopify',
  lightfunnels: 'Lightfunnels',
}

export function getPlatformLabel(source: OrderSource | null | undefined): string {
  return ORDER_PLATFORM_LABELS[source ?? 'manual'] ?? 'Manual'
}

// Gatilho de fluxo "Pedido criado" de cada plataforma.
export function orderTriggerSourceFor(source: OrderSource | null | undefined): TriggerSource {
  return source === 'lightfunnels' ? 'lightfunnels_order' : 'shopify_order'
}

// Número que o cliente reconhece (#1001), não a chave interna
// order_number (shopify-loja-123 / lightfunnels-conta-456).
export function getOrderDisplayNumber(order: OrderPlatformFields): string {
  if (order.source === 'lightfunnels' && order.lightfunnels_order_name) return order.lightfunnels_order_name
  if (order.source === 'shopify' && order.shopify_order_name) return order.shopify_order_name
  return order.shopify_order_name || order.lightfunnels_order_name || order.order_number || ''
}

// Pedido apagado/arquivado na plataforma de origem.
export function isOrderRemoved(order: OrderPlatformFields): boolean {
  return Boolean(order.shopify_deleted_at || order.lightfunnels_archived_at)
}

export function isOrderCancelled(order: OrderPlatformFields): boolean {
  return Boolean(order.shopify_cancelled_at || order.lightfunnels_cancelled_at)
}

// Pagamento já liquidado na plataforma (pré-pago): o FenixCOD não deve
// cobrar na entrega. Mesmo critério de isShopifyPaymentSettled: só 'paid'.
export function isOrderPaymentSettled(order: OrderPlatformFields): boolean {
  const status = order.source === 'lightfunnels' ? order.lightfunnels_financial_status : order.shopify_financial_status
  return String(status ?? '').toLowerCase() === 'paid'
}

export function getPlatformRemovedMessage(order: OrderPlatformFields): string {
  return `Pedido foi excluído no ${getPlatformLabel(order.source === 'lightfunnels' ? 'lightfunnels' : 'shopify')}`
}

export function getPlatformCancelledMessage(order: OrderPlatformFields): string {
  return `Pedido foi cancelado no ${getPlatformLabel(order.source === 'lightfunnels' ? 'lightfunnels' : 'shopify')}`
}

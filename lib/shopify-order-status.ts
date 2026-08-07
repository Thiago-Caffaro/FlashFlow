export interface ShopifyOrderStatusLike {
  shopify_financial_status?: string | null
  shopify_fulfillment_status?: string | null
  shopify_cancelled_at?: string | null
  shopify_cancel_reason?: string | null
  raw_shopify_payload?: Record<string, unknown> | null
}

export interface ShopifyOrderStatusSummary {
  financialStatus: string | null
  fulfillmentStatus: string | null
  cancelledAt: string | null
  cancelReason: string | null
  cancelled: boolean
}

const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pagamento pendente',
  authorized: 'Pagamento autorizado',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  partially_refunded: 'Reembolso parcial',
  refunded: 'Reembolsado',
  voided: 'Pagamento anulado',
  expired: 'Pagamento expirado',
}

const CANCEL_REASON_LABELS: Record<string, string> = {
  customer: 'Cancelado pelo cliente',
  fraud: 'Suspeita de fraude',
  inventory: 'Produto sem estoque',
  declined: 'Pagamento recusado',
  staff: 'Cancelado pela equipe',
  other: 'Outro motivo',
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

export function getShopifyOrderStatus(order: ShopifyOrderStatusLike): ShopifyOrderStatusSummary {
  const raw = order.raw_shopify_payload ?? {}
  const financialStatus = optionalString(order.shopify_financial_status) ?? optionalString(raw.financial_status)
  const fulfillmentStatus = optionalString(order.shopify_fulfillment_status) ?? optionalString(raw.fulfillment_status)
  const cancelledAt = optionalString(order.shopify_cancelled_at) ?? optionalString(raw.cancelled_at)
  const cancelReason = optionalString(order.shopify_cancel_reason) ?? optionalString(raw.cancel_reason)
  return {
    financialStatus,
    fulfillmentStatus,
    cancelledAt,
    cancelReason,
    cancelled: Boolean(cancelledAt),
  }
}

export function isShopifyOrderCancelled(order: ShopifyOrderStatusLike): boolean {
  return getShopifyOrderStatus(order).cancelled
}

export function shopifyFinancialStatusLabel(status: string | null): string {
  if (!status) return 'Pagamento não informado'
  return FINANCIAL_STATUS_LABELS[status.toLowerCase()] ?? status.replaceAll('_', ' ')
}

export function shopifyCancelReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return CANCEL_REASON_LABELS[reason.toLowerCase()] ?? reason.replaceAll('_', ' ')
}

export function isShopifyPaymentPending(status: string | null): boolean {
  return ['pending', 'authorized', 'partially_paid'].includes(String(status ?? '').toLowerCase())
}

export function isShopifyPaymentSettled(status: string | null): boolean {
  return String(status ?? '').toLowerCase() === 'paid'
}

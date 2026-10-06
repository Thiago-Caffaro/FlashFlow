import type { FulfillmentOrder } from '@/types'

// A lista de /fulfillment é recarregada periodicamente, então cada byte por
// pedido pesa no egress do Supabase. raw_shopify_payload (o JSON inteiro do
// pedido Shopify, vários KB) e external_snapshot (resposta do FenixCOD) não
// vão na lista: do payload cru, a UI só lê line_items (exibição de pacotes)
// e os fallbacks de status de lib/shopify-order-status.ts — extraídos aqui
// direto no Postgres.
const ORDER_LIST_COLUMNS = [
  'id', 'order_number', 'lead_number', 'instance_name', 'country', 'conversation_id',
  'contact_phone', 'customer_name', 'email', 'address', 'city', 'province', 'zipcode',
  'payment_type', 'items', 'total', 'currency', 'status', 'last_error', 'submitted_at',
  'source', 'shopify_integration_id', 'shopify_order_id', 'shopify_order_name',
  'shopify_order_number', 'shopify_deleted_at', 'shopify_financial_status',
  'shopify_fulfillment_status', 'shopify_cancelled_at', 'shopify_cancel_reason',
  'shopify_closed_at', 'commercial_status', 'send_status', 'delivery_status',
  'external_delivery_status', 'external_delivery_status_key', 'delivery_status_source',
  'delivery_status_synced_at', 'delivery_status_changed_at', 'delivery_status_sync_error',
  'confirmed_at', 'confirmation_status_updated_at', 'assigned_instance_name',
  'confirmation_message_sent_at', 'confirmation_message_error', 'is_simulation',
  'simulation_marker', 'order_placed_at', 'created_at', 'updated_at',
]

const RAW_PAYLOAD_FIELDS = {
  raw_line_items: 'raw_shopify_payload->line_items',
  raw_financial_status: 'raw_shopify_payload->>financial_status',
  raw_fulfillment_status: 'raw_shopify_payload->>fulfillment_status',
  raw_cancelled_at: 'raw_shopify_payload->>cancelled_at',
  raw_cancel_reason: 'raw_shopify_payload->>cancel_reason',
} as const

export const FULFILLMENT_ORDER_LIST_SELECT = [
  ...ORDER_LIST_COLUMNS,
  ...Object.entries(RAW_PAYLOAD_FIELDS).map(([alias, path]) => `${alias}:${path}`),
].join(', ')

type OrderListRow = Omit<FulfillmentOrder, 'raw_shopify_payload' | 'external_snapshot'>
  & Partial<Record<keyof typeof RAW_PAYLOAD_FIELDS, unknown>>

// Remonta raw_shopify_payload só com os campos extraídos, no mesmo formato
// que os componentes já leem (order.raw_shopify_payload?.line_items etc.).
export function toFulfillmentOrderListItem(row: OrderListRow): FulfillmentOrder {
  const {
    raw_line_items: lineItems,
    raw_financial_status: financialStatus,
    raw_fulfillment_status: fulfillmentStatus,
    raw_cancelled_at: cancelledAt,
    raw_cancel_reason: cancelReason,
    ...order
  } = row
  const payload: Record<string, unknown> = {}
  if (lineItems !== null && lineItems !== undefined) payload.line_items = lineItems
  if (financialStatus !== null && financialStatus !== undefined) payload.financial_status = financialStatus
  if (fulfillmentStatus !== null && fulfillmentStatus !== undefined) payload.fulfillment_status = fulfillmentStatus
  if (cancelledAt !== null && cancelledAt !== undefined) payload.cancelled_at = cancelledAt
  if (cancelReason !== null && cancelReason !== undefined) payload.cancel_reason = cancelReason
  return {
    ...order,
    raw_shopify_payload: Object.keys(payload).length > 0 ? payload : null,
    external_snapshot: null,
  }
}

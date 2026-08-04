import {
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  SEND_STATUSES,
  type CommercialStatus,
  type DeliveryStatus,
  type OrderStateField,
  type SendStatus,
} from '@/types'

export const ORDER_STATE_FIELDS: Array<{ value: OrderStateField; label: string }> = [
  { value: 'commercial_status', label: 'Status comercial' },
  { value: 'send_status', label: 'Status de envio' },
  { value: 'delivery_status', label: 'Status de entrega' },
]

export function isCommercialStatus(value: unknown): value is CommercialStatus {
  return (COMMERCIAL_STATUSES as readonly string[]).includes(String(value))
}

export function isSendStatus(value: unknown): value is SendStatus {
  return (SEND_STATUSES as readonly string[]).includes(String(value))
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(String(value))
}

export function isOrderStateField(value: unknown): value is OrderStateField {
  return ORDER_STATE_FIELDS.some((field) => field.value === value)
}

export function orderStateValues(field: OrderStateField): readonly string[] {
  if (field === 'commercial_status') return COMMERCIAL_STATUSES
  if (field === 'send_status') return SEND_STATUSES
  return DELIVERY_STATUSES
}

export function isOrderStateValue(field: OrderStateField, value: unknown): value is string {
  return orderStateValues(field).includes(String(value))
}

export function shouldSubmitToFenix(order: {
  commercial_status: CommercialStatus
  send_status: SendStatus
  lead_number: string | null
  is_simulation: boolean
}): boolean {
  return order.commercial_status.startsWith('Confirmado')
    && order.send_status === 'Pendente'
    && !order.lead_number
    && !order.is_simulation
}

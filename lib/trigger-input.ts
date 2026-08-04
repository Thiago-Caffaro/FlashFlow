import type { TriggerSource } from '@/types'
import { isDeliveryStatus } from './order-state'

const TRIGGER_SOURCES = new Set<TriggerSource>(['message', 'shopify_order', 'delivery_status'])

export function isTriggerSource(value: unknown): value is TriggerSource {
  return typeof value === 'string' && TRIGGER_SOURCES.has(value as TriggerSource)
}

export function validateDeliveryTriggerPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const statuses = (value as Record<string, unknown>).statuses
  if (statuses === undefined) return null
  if (!Array.isArray(statuses) || statuses.length > 6) return 'Estados de entrega inválidos'
  if (statuses.some((status) => status !== '*' && !isDeliveryStatus(status))) {
    return 'Estados de entrega inválidos'
  }
  return null
}

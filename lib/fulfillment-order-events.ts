import type { DeliveryStatus } from '@/types'

export interface FulfillmentOrderEventRow {
  id: string
  event_type: string
  payload: unknown
  created_at: string
}

export interface FulfillmentOrderTimelineEntry {
  id: string
  createdAt: string
  message: string
  critical: boolean
}

// Eventos que fazem parte do ciclo de vida do pedido na FenixCOD (envio,
// criação do lead, falhas, cancelamento, mudanças de status de entrega).
// Outros event_type (ex: items_updated, country_updated, edições feitas no
// FlashFlow) ficam de fora — essa timeline é especificamente sobre o que
// aconteceu do lado da FenixCOD, não um log de auditoria geral do pedido.
const RELEVANT_EVENT_TYPES = new Set([
  'pending_operator',
  'submitting',
  'created',
  'failed',
  'unknown',
  'cancelled',
  'cancelled_local',
  'delivery_status_changed',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function describeEvent(eventType: string, payload: Record<string, unknown>): { message: string; critical: boolean } {
  switch (eventType) {
    case 'pending_operator':
      return { message: 'Pedido criado, aguardando envio à FenixCOD', critical: false }
    case 'submitting':
      return { message: 'Enviando pedido para a FenixCOD...', critical: false }
    case 'created': {
      const leadNumber = stringValue(payload.lead_number)
      return { message: `Pedido criado na FenixCOD${leadNumber ? ` (lead ${leadNumber})` : ''}`, critical: false }
    }
    case 'failed': {
      const error = stringValue(payload.error)
      return { message: `Falha ao enviar para a FenixCOD${error ? `: ${error}` : ''}`, critical: true }
    }
    case 'unknown': {
      const error = stringValue(payload.error)
      return { message: `Envio à FenixCOD com status incerto${error ? `: ${error}` : ''}`, critical: true }
    }
    case 'cancelled': {
      const leadNumber = stringValue(payload.lead_number)
      return { message: `Pedido cancelado na FenixCOD${leadNumber ? ` (lead ${leadNumber})` : ''}`, critical: true }
    }
    case 'cancelled_local':
      return { message: 'Pedido cancelado localmente antes do envio', critical: true }
    case 'delivery_status_changed': {
      const previous = stringValue(payload.previous_status) || '—'
      const next = stringValue(payload.delivery_status) as DeliveryStatus | ''
      const external = stringValue(payload.external_status)
      return {
        message: `Status de entrega: ${previous} → ${next || '—'}${external ? ` (FenixCOD: "${external}")` : ''}`,
        critical: next === 'Rejeitado',
      }
    }
    default:
      return { message: `Evento: ${eventType}`, critical: false }
  }
}

export function normalizeFulfillmentOrderEvents(events: FulfillmentOrderEventRow[]): FulfillmentOrderTimelineEntry[] {
  return events
    .filter((event) => RELEVANT_EVENT_TYPES.has(event.event_type))
    .map((event) => {
      const { message, critical } = describeEvent(event.event_type, asRecord(event.payload))
      return { id: event.id, createdAt: event.created_at, message, critical }
    })
    .filter((event) => event.createdAt && Number.isFinite(new Date(event.createdAt).getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

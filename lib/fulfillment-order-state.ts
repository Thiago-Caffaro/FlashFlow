import 'server-only'
import type { OrderStateField } from '@/types'
import { supabaseAdmin } from './supabase-admin'
import {
  FulfillmentOrderSubmissionError,
  recordOrderEvent,
  submitFulfillmentOrder,
} from './fulfillment-service'
import { isOrderStateField, isOrderStateValue, shouldSubmitToFenix } from './order-state'

type ConfirmationOrderRow = {
  id: string
  lead_number: string | null
  commercial_status: import('@/types').CommercialStatus
  send_status: import('@/types').SendStatus
  status: string
  is_simulation: boolean
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

export async function updateFulfillmentOrderState(input: {
  orderId: string
  field: OrderStateField
  value: string
  source?: string
}) {
  if (!isOrderStateField(input.field) || !isOrderStateValue(input.field, input.value)) {
    throw new Error('Estado do pedido inválido')
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    [input.field]: input.value,
    updated_at: now,
  }
  if (input.field === 'commercial_status') {
    patch.confirmation_status_updated_at = now
    patch.confirmed_at = input.value.startsWith('Confirmado') ? now : null
  }
  if (input.field === 'delivery_status') {
    patch.delivery_status_source = input.source?.startsWith('flow:') ? 'flow' : 'manual'
    patch.delivery_status_changed_at = now
  }

  const { data, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .update(patch)
    .eq('id', input.orderId)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar pedido')

  await recordOrderEvent(input.orderId, 'order_state_updated', {
    field: input.field,
    value: input.value,
    source: input.source ?? 'unknown',
  })

  const autoSubmit = await maybeAutoSubmitConfirmedOrder(input.orderId)
  return { order: autoSubmit.order ?? data, autoSubmit }
}

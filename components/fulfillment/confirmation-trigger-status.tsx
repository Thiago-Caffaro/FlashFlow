import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react'
import type { ConfirmationTriggerState, FulfillmentOrder } from '@/types'

export function getConfirmationTriggerState(
  order: Pick<FulfillmentOrder, 'confirmation_message_sent_at' | 'confirmation_message_error'>,
): ConfirmationTriggerState {
  if (order.confirmation_message_sent_at) return 'sent'
  if (order.confirmation_message_error) return 'failed'
  return 'pending'
}

const statusConfig = {
  sent: {
    label: 'Gatilho disparado',
    Icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  failed: {
    label: 'Falha no gatilho',
    Icon: AlertCircle,
    className: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  },
  pending: {
    label: 'Gatilho pendente',
    Icon: Clock3,
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  },
} as const

export default function ConfirmationTriggerStatus({
  order,
  compact = false,
}: {
  order: Pick<FulfillmentOrder, 'confirmation_message_sent_at' | 'confirmation_message_error'>
  compact?: boolean
}) {
  const state = getConfirmationTriggerState(order)
  const { label, Icon, className } = statusConfig[state]

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
      title={state === 'failed' ? order.confirmation_message_error ?? undefined : undefined}
    >
      <Icon size={12} />
      {compact ? (state === 'sent' ? 'Disparado' : state === 'failed' ? 'Falhou' : 'Pendente') : label}
    </span>
  )
}

import { CircleAlert, CircleCheck, CreditCard, Tag, XCircle } from 'lucide-react'
import type { FulfillmentOrder } from '@/types'
import { shopifyFinancialStatusLabel } from '@/lib/shopify-order-status'

interface LightfunnelsOrderStatusBadgesProps {
  order: FulfillmentOrder
  compact?: boolean
}

// Status do pedido no Lightfunnels (equivalente a ShopifyOrderStatusBadges).
// Os valores de financial_status do Lightfunnels (pending, paid, refunded,
// partially_refunded) são um subconjunto dos da Shopify, então os rótulos
// são os mesmos.
export default function LightfunnelsOrderStatusBadges({ order, compact = false }: LightfunnelsOrderStatusBadgesProps) {
  if (order.source !== 'lightfunnels') return null
  const financialStatus = order.lightfunnels_financial_status ?? null
  const cancelled = Boolean(order.lightfunnels_cancelled_at || order.lightfunnels_archived_at)
  const padding = compact ? 'px-1.5 py-0.5' : 'px-2 py-1'
  const iconSize = compact ? 11 : 12

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full bg-indigo-100 ${padding} text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300`}>
        Lightfunnels
      </span>
      {cancelled && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-red-100 ${padding} text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300`}>
          <XCircle size={iconSize} />
          {order.lightfunnels_archived_at ? 'Arquivado no Lightfunnels' : 'Cancelado no Lightfunnels'}
        </span>
      )}
      {!cancelled && financialStatus === 'pending' && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-amber-100 ${padding} text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300`}>
          <CircleAlert size={iconSize} />
          {shopifyFinancialStatusLabel(financialStatus)}{order.payment_type === 'COD' ? ' · contraentrega' : ''}
        </span>
      )}
      {!cancelled && financialStatus === 'paid' && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 ${padding} text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>
          <CircleCheck size={iconSize} />
          {shopifyFinancialStatusLabel(financialStatus)}
        </span>
      )}
      {!cancelled && financialStatus && !['pending', 'paid'].includes(financialStatus) && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 ${padding} text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>
          <CreditCard size={iconSize} />
          {shopifyFinancialStatusLabel(financialStatus)}
        </span>
      )}
      {!compact && order.lightfunnels_writeback_error && (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-red-50 ${padding} text-xs font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-300`}
          title={order.lightfunnels_writeback_error}
        >
          <Tag size={iconSize} />
          Falha ao gravar tags no Lightfunnels
        </span>
      )}
    </div>
  )
}

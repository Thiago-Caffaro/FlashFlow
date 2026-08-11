import { CircleAlert, CircleCheck, CreditCard, XCircle } from 'lucide-react'
import type { FulfillmentOrder } from '@/types'
import {
  getShopifyOrderStatus,
  isShopifyPaymentPending,
  isShopifyPaymentSettled,
  shopifyCancelReasonLabel,
  shopifyFinancialStatusLabel,
} from '@/lib/shopify-order-status'

export default function ShopifyOrderStatusBadges({
  order,
  compact = false,
}: {
  order: FulfillmentOrder
  compact?: boolean
}) {
  if (order.source !== 'shopify') return null
  const status = getShopifyOrderStatus(order)
  const financialLabel = shopifyFinancialStatusLabel(status.financialStatus)
  const cancelReason = shopifyCancelReasonLabel(status.cancelReason)
  const padding = compact ? 'px-1.5 py-0.5' : 'px-2 py-1'

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status.cancelled && (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-red-100 ${padding} text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300`}
          title={cancelReason ?? undefined}
        >
          <XCircle size={compact ? 11 : 12} />
          Cancelado no Shopify{!compact && cancelReason ? ` · ${cancelReason}` : ''}
        </span>
      )}
      {!status.cancelled && isShopifyPaymentPending(status.financialStatus) && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-amber-100 ${padding} text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300`}>
          <CircleAlert size={compact ? 11 : 12} />
          {financialLabel}{order.payment_type === 'COD' ? ' · contraentrega' : ''}
        </span>
      )}
      {!status.cancelled && isShopifyPaymentSettled(status.financialStatus) && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 ${padding} text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>
          <CircleCheck size={compact ? 11 : 12} />
          {financialLabel}
        </span>
      )}
      {!status.cancelled && status.financialStatus && !isShopifyPaymentPending(status.financialStatus) && !isShopifyPaymentSettled(status.financialStatus) && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 ${padding} text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>
          <CreditCard size={compact ? 11 : 12} />
          {financialLabel}
        </span>
      )}
    </div>
  )
}

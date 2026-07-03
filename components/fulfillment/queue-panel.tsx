'use client'

import { useMemo, useState } from 'react'
import { Clock, Phone } from 'lucide-react'
import {
  Account,
  FulfillmentOrder,
  type CommercialStatus,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'
import OrderEditModal from './order-edit-modal'

type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

interface QueuePanelProps {
  orders: FulfillmentOrder[]
  accounts: Account[]
  onUpdateOrderStatus: (id: string, patch: {
    commercial_status?: CommercialStatus
    send_status?: SendStatus
    delivery_status?: DeliveryStatus
    assigned_instance_name?: string
  }) => Promise<void>
  onOrderAction: (id: string, action: OrderAction) => Promise<void>
  onResendConfirmation: (orderId: string) => Promise<void>
}

function waitingSince(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(ms / (60 * 1000)))
    return `${minutes} min`
  }
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function QueuePanel({
  orders, accounts, onUpdateOrderStatus, onOrderAction, onResendConfirmation,
}: QueuePanelProps) {
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)

  const queueOrders = useMemo(() => {
    return orders
      .filter((o) => o.commercial_status === 'Não responde' && !o.is_simulation)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [orders])

  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) ?? null : null

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <h2 className="font-bold dark:text-[#e9edef]">Fila de atendimento</h2>
        <p className="mt-1 text-sm text-[#667781]">
          Pedidos aguardando confirmação por ligação ou WhatsApp, do mais antigo para o mais novo. Some da fila assim que o status comercial deixa de ser &quot;Não responde&quot;.
        </p>
      </div>

      {queueOrders.length === 0 && (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm dark:bg-[#111b21]">
          <p className="text-sm text-[#667781]">Fila vazia — nenhum pedido aguardando confirmação.</p>
        </div>
      )}

      <div className="space-y-3">
        {queueOrders.map((order) => {
          const accountLabel = accounts.find(
            (a) => a.instanceName === (order.assigned_instance_name || order.instance_name)
          )?.label

          return (
            <div
              key={order.id}
              onClick={() => setOpenOrderId(order.id)}
              className="cursor-pointer rounded-xl bg-white p-5 shadow-sm hover:bg-[#f8f9fa] dark:bg-[#111b21] dark:hover:bg-[#1a2730]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold dark:text-[#e9edef]">{order.customer_name}</p>
                  <a
                    href={`tel:${order.contact_phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-sm text-[#00a884] hover:underline"
                  >
                    <Phone size={12} />{order.contact_phone || 'Sem telefone'}
                  </a>
                  <p className="text-xs text-[#667781]">
                    {order.city}{order.province ? `, ${order.province}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="flex items-center justify-end gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <Clock size={12} />aguardando há {waitingSince(order.created_at)}
                  </p>
                  <p className="mt-1 text-sm dark:text-[#e9edef]">
                    {order.currency} {Number(order.total).toFixed(2)}
                  </p>
                  {accountLabel && <p className="text-xs text-[#667781]">{accountLabel}</p>}
                </div>
              </div>
              {order.items?.length > 0 && (
                <p className="mt-2 text-xs text-[#667781]">
                  {order.items.map((item) => `${item.name || item.sku} × ${item.quantity}`).join(', ')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {openOrder && (
        <OrderEditModal
          order={openOrder}
          accounts={accounts}
          onClose={() => setOpenOrderId(null)}
          onUpdateStatus={onUpdateOrderStatus}
          onAction={onOrderAction}
          onResendConfirmation={onResendConfirmation}
        />
      )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, ChevronUp, Clock, Loader2, MessageCircle, Phone, Send, Users, X, XCircle } from 'lucide-react'
import {
  Account,
  FulfillmentOrder,
  ShopifyProduct,
  type CommercialStatus,
  type ConfirmationTriggerState,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'
import OrderEditModal from './order-edit-modal'
import CustomerOrderGroup from './customer-order-group'
import { groupOrdersByCustomer, type CustomerGroup } from '@/lib/fulfillment-grouping'
import ConfirmationTriggerStatus from './confirmation-trigger-status'

type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

interface QueuePanelProps {
  orders: FulfillmentOrder[]
  busyId: string | null
  accounts: Account[]
  integrations: Array<{ country: string; active: boolean }>
  shopifyProducts: ShopifyProduct[]
  onOpenShopifyProducts: () => void
  onUpdateOrderStatus: (id: string, patch: {
    country?: string
    commercial_status?: CommercialStatus
    send_status?: SendStatus
    delivery_status?: DeliveryStatus
    assigned_instance_name?: string
    confirmation_trigger_state?: ConfirmationTriggerState
  }) => Promise<void>
  onUpdateItems: (id: string, items: FulfillmentOrder['items']) => Promise<void>
  onOrderAction: (id: string, action: OrderAction) => Promise<void>
  onResendConfirmation: (orderId: string) => Promise<void>
  onBulkUpdateStatus: (ids: string[], status: CommercialStatus) => Promise<void>
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

function QueueOrderCard({
  order,
  accountLabel,
  selected,
  busy,
  canSubmit,
  canRunConfirmation,
  onToggleSelect,
  onClick,
  onSubmit,
  onRunConfirmation,
}: {
  order: FulfillmentOrder
  accountLabel: string | undefined
  selected: boolean
  busy: boolean
  canSubmit: boolean
  canRunConfirmation: boolean
  onToggleSelect: () => void
  onClick: () => void
  onSubmit: () => void
  onRunConfirmation: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-xl bg-white p-5 shadow-sm hover:bg-[#f8f9fa] dark:bg-[#111b21] dark:hover:bg-[#1a2730]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-4 w-4 shrink-0 accent-[#00a884]"
          />
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
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Clock size={12} />aguardando há {waitingSince(order.created_at)}
          </p>
          <p className="mt-1 text-sm dark:text-[#e9edef]">
            {order.currency} {Number(order.total).toFixed(2)}
          </p>
          {accountLabel && <p className="text-xs text-[#667781]">{accountLabel}</p>}
          <div className="mt-1.5 flex justify-end">
            <ConfirmationTriggerStatus order={order} compact />
          </div>
        </div>
      </div>
      {order.items?.length > 0 && (
        <p className="mt-2 pl-7 text-xs text-[#667781]">
          {order.items.map((item) => `${item.name || item.sku} × ${item.quantity}`).join(', ')}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#f0f2f5] pt-3 dark:border-[#2a3942]">
        {canRunConfirmation && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRunConfirmation()
            }}
            disabled={busy}
            className="flex min-h-9 items-center gap-2 rounded-lg border border-[#d1d7db] px-3 py-2 text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-50 dark:border-[#3d4f5a] dark:text-[#e9edef] dark:hover:bg-[#2a3942]"
            title="Executar manualmente o gatilho de confirmação deste pedido"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
            Rodar confirmação
          </button>
        )}
        {!order.lead_number && !order.is_simulation && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSubmit()
            }}
            disabled={busy || !canSubmit}
            className="flex min-h-9 items-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-semibold text-white hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-40"
            title={canSubmit
              ? 'Enviar este pedido ao FenixCOD'
              : 'Configure a integração do país e corrija o pedido antes do envio'}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar FenixCOD
          </button>
        )}
      </div>
    </div>
  )
}

function QueueGroupHeader({
  group, expanded, allSelected, onToggleSelectAll,
}: {
  group: CustomerGroup
  expanded: boolean
  allSelected: boolean
  onToggleSelectAll: () => void
}) {
  const oldest = group.orders.reduce((a, b) =>
    new Date(a.created_at).getTime() < new Date(b.created_at).getTime() ? a : b
  )
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm hover:bg-[#f8f9fa] dark:bg-[#111b21] dark:hover:bg-[#1a2730]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-4 w-4 shrink-0 accent-[#00a884]"
          />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold dark:text-[#e9edef]">{group.customerName}</p>
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <Users size={11} />{group.orders.length} pedidos
              </span>
            </div>
            <a
              href={`tel:${group.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-sm text-[#00a884] hover:underline"
            >
              <Phone size={12} />{group.phone || 'Sem telefone'}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <p className="flex items-center justify-end gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Clock size={12} />aguardando há {waitingSince(oldest.created_at)}
          </p>
          {expanded ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
        </div>
      </div>
    </div>
  )
}

export default function QueuePanel({
  orders, busyId, accounts, integrations, shopifyProducts, onOpenShopifyProducts,
  onUpdateOrderStatus, onUpdateItems, onOrderAction, onResendConfirmation, onBulkUpdateStatus,
}: QueuePanelProps) {
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const queueOrders = useMemo(() => {
    return orders
      .filter((o) => o.commercial_status === 'Não responde' && !o.is_simulation)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [orders])

  const groups = useMemo(() => groupOrdersByCustomer(queueOrders), [queueOrders])

  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) ?? null : null

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectMany(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.every((id) => next.has(id))
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (prev.size === queueOrders.length) return new Set()
      return new Set(queueOrders.map((o) => o.id))
    })
  }

  async function handleBulkStatus(status: CommercialStatus) {
    setBulkBusy(true)
    await onBulkUpdateStatus([...selectedIds], status)
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold dark:text-[#e9edef]">Fila de atendimento</h2>
            <p className="mt-1 text-sm text-[#667781]">
              Pedidos aguardando confirmação por ligação ou WhatsApp, do mais antigo para o mais novo. Some da fila assim que o status comercial deixa de ser &quot;Não responde&quot;.
            </p>
          </div>
          {queueOrders.length > 0 && (
            <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#667781]">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === queueOrders.length}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 accent-[#00a884]"
              />
              Selecionar todos ({queueOrders.length})
            </label>
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-[#111b21] px-4 py-3 text-sm text-white shadow-sm dark:bg-[#1a2730]">
          <span className="font-semibold">{selectedIds.size} selecionado(s)</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => handleBulkStatus('Confirmado')}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008f72] disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
              Marcar como concluído
            </button>
            <button
              onClick={() => handleBulkStatus('Desistiu')}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              Marcar como não concluído
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            >
              <X size={13} />
              Limpar seleção
            </button>
          </div>
        </div>
      )}

      {queueOrders.length === 0 && (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm dark:bg-[#111b21]">
          <p className="text-sm text-[#667781]">Fila vazia — nenhum pedido aguardando confirmação.</p>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const groupIds = group.orders.map((o) => o.id)
          const allSelected = groupIds.every((id) => selectedIds.has(id))
          return (
            <CustomerOrderGroup
              key={group.key}
              group={group}
              renderGroupHeader={(g, expanded) => (
                <QueueGroupHeader
                  group={g}
                  expanded={expanded}
                  allSelected={allSelected}
                  onToggleSelectAll={() => toggleSelectMany(groupIds)}
                />
              )}
              renderOrder={(order) => {
                const accountLabel = accounts.find(
                  (a) => a.instanceName === (order.assigned_instance_name || order.instance_name)
                )?.label
                const hasCountryIntegration = integrations.some(
                  (integration) => integration.active && integration.country === order.country
                )
                const canSubmit = !order.lead_number
                  && hasCountryIntegration
                  && ['pending_operator', 'failed'].includes(order.status)
                  && !order.is_simulation
                const canRunConfirmation = order.source === 'shopify' && !order.is_simulation
                return (
                  <QueueOrderCard
                    order={order}
                    accountLabel={accountLabel}
                    selected={selectedIds.has(order.id)}
                    busy={busyId === order.id}
                    canSubmit={canSubmit}
                    canRunConfirmation={canRunConfirmation}
                    onToggleSelect={() => toggleSelect(order.id)}
                    onClick={() => setOpenOrderId(order.id)}
                    onRunConfirmation={() => {
                      if (!window.confirm('Executar o gatilho de confirmação e enviar uma nova mensagem para este cliente?')) return
                      void onResendConfirmation(order.id)
                    }}
                    onSubmit={() => {
                      if (!window.confirm('Enviar este pedido para o FenixCOD agora?')) return
                      void onOrderAction(order.id, 'submit')
                    }}
                  />
                )
              }}
            />
          )
        })}
      </div>

      {openOrder && (
        <OrderEditModal
          order={openOrder}
          accounts={accounts}
          fulfillmentCountries={integrations.filter((integration) => integration.active).map((integration) => integration.country)}
          shopifyProducts={shopifyProducts}
          onOpenShopifyProducts={onOpenShopifyProducts}
          onClose={() => setOpenOrderId(null)}
          onUpdateStatus={onUpdateOrderStatus}
          onUpdateItems={onUpdateItems}
          onAction={onOrderAction}
          onResendConfirmation={onResendConfirmation}
        />
      )}
    </div>
  )
}

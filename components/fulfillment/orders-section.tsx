'use client'

import { useMemo, useState } from 'react'
import {
  Calendar, ChevronDown, ChevronUp, Download, FilePen, Loader2, MessageCircle,
  Package, RefreshCw, Search, Send, ShoppingCart, Truck, Users, X,
} from 'lucide-react'
import {
  Account,
  ABANDONED_CHECKOUT_STATUSES,
  ExternalFulfillmentLead,
  FulfillmentOrder,
  ShopifyAbandonedCheckout,
  ShopifyProduct,
  type ShopifyCheckoutSource,
  type AbandonedCheckoutStatus,
  type CommercialStatus,
  type ConfirmationTriggerState,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'
import OrderEditModal from './order-edit-modal'
import CustomerOrderGroup from './customer-order-group'
import { groupOrdersByCustomer, type CustomerGroup } from '@/lib/fulfillment-grouping'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import ConfirmationTriggerStatus from './confirmation-trigger-status'
import OrderFilterBar from './order-filter-bar'
import PaginationControls from './pagination-controls'
import {
  createOrderFilters, filterOrders, paginate, sortOrders, uniqueCountries, type OrderFilters,
} from '@/lib/fulfillment-order-filters'
import { getOrderDisplayNumber, isOrderCancelled, isOrderPaymentSettled, isOrderRemoved } from '@/lib/order-platform'
import LightfunnelsOrderStatusBadges from './lightfunnels-order-status-badges'
import ShopifyOrderStatusBadges from './shopify-order-status-badges'
import { getShopifyOrderStatus, isShopifyOrderCancelled, isShopifyPaymentSettled } from '@/lib/shopify-order-status'

type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

export interface Integration {
  id: string
  country: string
  environment: 'test' | 'production'
  active: boolean
  token_expires_at: string | null
}

interface OrdersSectionProps {
  orders: FulfillmentOrder[]
  accounts: Account[]
  abandonedCheckouts: ShopifyAbandonedCheckout[]
  integrations: Integration[]
  busyId: string | null
  syncBusy: boolean
  shopifyIntegrationsCount: number
  shopifyProducts: ShopifyProduct[]
  onSyncShopify: () => Promise<void>
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
  onUpdateCheckout: (id: string, patch: { recovery_status?: AbandonedCheckoutStatus; assigned_instance_name?: string }) => Promise<void>
  onRecoverCheckout: (id: string) => Promise<void>
  onOpenShopifyProducts: () => void
}

const inputClass = 'rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

function CommercialBadge({ status }: { status: CommercialStatus }) {
  const color = status.startsWith('Confirmado')
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'Desistiu'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{status}</span>
}

function SendBadge({ status }: { status: SendStatus }) {
  const color = status === 'Enviado'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'Pendente'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{status}</span>
}

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const color = status === 'Entregue'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'Rejeitado'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : status === 'A caminho' || status === 'Enviado'
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{status}</span>
}

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

function isFallbackLead(lead: ExternalFulfillmentLead) {
  return /^external-\d+$/.test(lead.lead_number)
}

function formatOrderDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function OrderRow({
  order, accounts, busyId, onOpen, onResendConfirmation, onOrderAction,
}: {
  order: FulfillmentOrder
  accounts: Account[]
  busyId: string | null
  onOpen: () => void
  onResendConfirmation: (orderId: string) => Promise<void>
  onOrderAction: (id: string, action: OrderAction) => Promise<void>
}) {
  const hasLead = Boolean(order.lead_number)
  const shopifyCancelled = isShopifyOrderCancelled(order) || isOrderCancelled(order) || isOrderRemoved(order)
  const alreadyPaidExternally = order.source === 'lightfunnels'
    ? isOrderPaymentSettled(order)
    : isShopifyPaymentSettled(getShopifyOrderStatus(order).financialStatus)
  const canSubmit = !shopifyCancelled && !hasLead && ['pending_operator', 'failed'].includes(order.status) && !order.is_simulation
  const isBusy = busyId === order.id
  const accountLabel = accounts.find((a) => a.instanceName === (order.assigned_instance_name || order.instance_name))?.label
  const isSandboxOrder = (order.assigned_instance_name || order.instance_name) === SANDBOX_INSTANCE_NAME
  // Sandbox test orders can re-run the confirmation trigger repeatedly; real
  // simulations (not tied to the sandbox) stay blocked from ever sending.
  const canResend = !shopifyCancelled && (order.source === 'shopify' || order.source === 'lightfunnels') && (!order.confirmation_message_sent_at || (order.is_simulation && isSandboxOrder))

  return (
    <div
      className={`grid cursor-pointer items-center gap-3 border-b px-5 py-4 text-sm last:border-0 lg:grid-cols-[1.5fr_1fr_1.1fr_0.65fr_0.65fr_auto] ${shopifyCancelled ? 'border-red-100 bg-red-50/60 hover:bg-red-50 dark:border-red-950 dark:bg-red-950/20 dark:hover:bg-red-950/30' : 'border-[#f0f2f5] hover:bg-[#f8f9fa] dark:border-[#2a3942] dark:hover:bg-[#1a2730]'}`}
      onClick={onOpen}
    >
      <div>
        <span className="font-semibold dark:text-[#e9edef]">{order.customer_name}</span>
        <p className="text-xs text-[#667781]">{order.contact_phone || 'Sem tel.'}</p>
        <p className="text-xs text-[#667781]">{order.city}</p>
      </div>
      <div>
        <span className="dark:text-[#e9edef]">{getOrderDisplayNumber(order)}</span>
        <p className="text-xs text-[#667781]">
          {order.country} ·{' '}
          {alreadyPaidExternally ? (
            <>
              <span className="line-through">{order.currency} {Number(order.total).toFixed(2)}</span>{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{order.currency} 0,00</span>
            </>
          ) : (
            <>{order.currency} {Number(order.total).toFixed(2)}</>
          )}
        </p>
        {accountLabel && <p className="text-xs text-[#667781]">{accountLabel}</p>}
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-[#54656f] dark:text-[#aebac1]" title="Data e hora do pedido">
          <Calendar size={11} />{formatOrderDateTime(order.order_placed_at)}
        </p>
        <p className="flex items-center gap-1 text-[11px] text-[#8696a0]" title="Quando este pedido entrou no FlashFlow">
          <Download size={10} />recebido {formatOrderDateTime(order.created_at)}
        </p>
        <div className="mt-1.5"><ShopifyOrderStatusBadges order={order} compact /><LightfunnelsOrderStatusBadges order={order} compact /></div>
        {order.is_simulation && <span className="text-xs text-purple-600 dark:text-purple-400">simulação</span>}
      </div>
      <div>
        <CommercialBadge status={order.commercial_status} />
        {(order.source === 'shopify' || order.source === 'lightfunnels') && (
          <div className="mt-1.5"><ConfirmationTriggerStatus order={order} compact /></div>
        )}
      </div>
      <div>
        <SendBadge status={order.send_status} />
      </div>
      <div>
        <DeliveryBadge status={order.delivery_status} />
        {hasLead && <p className="mt-0.5 text-xs text-[#667781]">#{order.lead_number}</p>}
      </div>
      {/* Quick actions — stop propagation so they don't open the modal */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {canResend && (
          <button
            onClick={() => onResendConfirmation(order.id)}
            disabled={isBusy || (order.is_simulation && !isSandboxOrder)}
            className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-40 dark:hover:bg-[#2a3942]"
            title="Rodar gatilho de confirmação"
          >
            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
          </button>
        )}
        {canSubmit && (
          <button
            onClick={() => {
              if (!window.confirm('Enviar para FenixCOD?')) return
              onOrderAction(order.id, 'submit')
            }}
            disabled={isBusy}
            className="rounded-lg p-2 text-[#00a884] hover:bg-[#e7f8f4] disabled:opacity-40"
            title="Enviar ao FenixCOD"
          >
            <Send size={14} />
          </button>
        )}
        {hasLead && (
          <button
            onClick={() => onOrderAction(order.id, 'refresh')}
            disabled={isBusy}
            className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-40 dark:hover:bg-[#2a3942]"
            title="Atualizar do FenixCOD"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function OrderGroupHeader({ group, expanded }: { group: CustomerGroup; expanded: boolean }) {
  const mostRecent = group.orders.reduce((a, b) =>
    new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
  )
  return (
    <div className="grid items-center gap-3 border-b border-[#f0f2f5] px-5 py-4 text-sm last:border-0 hover:bg-[#f8f9fa] dark:border-[#2a3942] dark:hover:bg-[#1a2730] lg:grid-cols-[1.5fr_1fr_1.1fr_0.65fr_0.65fr_auto]">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold dark:text-[#e9edef]">{group.customerName}</span>
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <Users size={11} />{group.orders.length}
          </span>
        </div>
        <p className="text-xs text-[#667781]">{group.phone || 'Sem tel.'}</p>
      </div>
      <div className="text-xs text-[#667781]">Pedido mais recente:</div>
      <div>
        <CommercialBadge status={mostRecent.commercial_status} />
        <div className="mt-1.5"><ShopifyOrderStatusBadges order={mostRecent} compact /></div>
      </div>
      <div>
        <SendBadge status={mostRecent.send_status} />
      </div>
      <div>
        <DeliveryBadge status={mostRecent.delivery_status} />
      </div>
      <div className="flex justify-end">
        {expanded ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
      </div>
    </div>
  )
}

export default function OrdersSection({
  orders, accounts, abandonedCheckouts, integrations,
  busyId, syncBusy, shopifyIntegrationsCount, shopifyProducts,
  onSyncShopify, onUpdateOrderStatus, onUpdateItems, onOrderAction,
  onResendConfirmation, onUpdateCheckout, onRecoverCheckout, onOpenShopifyProducts,
}: OrdersSectionProps) {
  const [filters, setFilters] = useState<OrderFilters>(() => createOrderFilters('received_desc'))
  const [page, setPage] = useState(1)
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const [showCheckouts, setShowCheckouts] = useState(false)
  const [checkoutSourceFilter, setCheckoutSourceFilter] = useState<'' | ShopifyCheckoutSource>('')
  const [checkoutPage, setCheckoutPage] = useState(1)
  // Linhas antigas (antes da migration 028) não têm `source`: são checkouts.
  const draftCount = abandonedCheckouts.filter((checkout) => checkout.source === 'draft_order').length
  const filteredCheckouts = checkoutSourceFilter
    ? abandonedCheckouts.filter((checkout) => (checkout.source ?? 'checkout') === checkoutSourceFilter)
    : abandonedCheckouts
  const checkoutsPage = paginate(filteredCheckouts, checkoutPage)
  const visibleCheckouts = checkoutsPage.items

  const [showFenix, setShowFenix] = useState(false)
  const activeIntegrations = integrations.filter((i) => i.active)
  const [fenixCountry, setFenixCountry] = useState(activeIntegrations[0]?.country ?? '')
  const [fenixLeads, setFenixLeads] = useState<ExternalFulfillmentLead[]>([])
  const [fenixBusy, setFenixBusy] = useState(false)
  const [fenixFetchedAt, setFenixFetchedAt] = useState<string | null>(null)

  const localLeadNumbers = useMemo(
    () => new Set(orders.map((o) => o.lead_number).filter((l): l is string => Boolean(l))),
    [orders]
  )

  const filteredOrders = useMemo(
    () => sortOrders(filterOrders(orders, filters), filters.sort),
    [orders, filters],
  )

  // A paginação é por linha da lista (cliente ou grupo de cliente), não por pedido:
  // um cliente com vários pedidos ocupa uma linha e expande no lugar.
  const groups = useMemo(() => groupOrdersByCustomer(filteredOrders), [filteredOrders])
  const groupsPage = paginate(groups, page)
  const countries = useMemo(() => uniqueCountries(orders), [orders])

  function updateFilters(patch: Partial<OrderFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }

  function clearFilters() {
    setFilters((prev) => createOrderFilters(prev.sort))
    setPage(1)
  }

  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) ?? null : null

  async function loadFenixLeads() {
    if (!fenixCountry) return
    setFenixBusy(true)
    const json = await fetch(`/api/fulfillment/external-leads?country=${encodeURIComponent(fenixCountry)}`, { cache: 'no-store' }).then(getJson)
    if (json.ok) {
      setFenixLeads((json.leads as ExternalFulfillmentLead[]) ?? [])
      setFenixFetchedAt(new Date().toISOString())
    }
    setFenixBusy(false)
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 ml-auto">
          <button onClick={onOpenShopifyProducts} className={btnSecondary}>
            <Package size={14} />Produtos reais
          </button>
          <button
            onClick={() => setShowFenix(true)}
            disabled={activeIntegrations.length === 0}
            className={btnSecondary}
          >
            <Search size={14} />Consultar FenixCOD
          </button>
          <button
            onClick={onSyncShopify}
            disabled={syncBusy || shopifyIntegrationsCount === 0}
            className={btnPrimary}
          >
            {syncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar Shopify
          </button>
        </div>
      </div>

      <OrderFilterBar
        filters={filters}
        onChange={updateFilters}
        onClear={clearFilters}
        accounts={accounts}
        countries={countries}
      />

      {/* Orders table */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <div className="hidden border-b border-[#f0f2f5] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:border-[#2a3942] lg:grid lg:grid-cols-[1.5fr_1fr_1.1fr_0.65fr_0.65fr_auto]">
          <span>Cliente</span>
          <span>Pedido</span>
          <span>Status</span>
          <span>Envio</span>
          <span>Entrega</span>
          <span>Ações</span>
        </div>
        {filteredOrders.length === 0 && (
          <p className="p-8 text-center text-sm text-[#667781]">Nenhum pedido encontrado.</p>
        )}
        {groupsPage.items.map((group) => (
          <CustomerOrderGroup
            key={group.key}
            group={group}
            renderGroupHeader={(g, expanded) => <OrderGroupHeader group={g} expanded={expanded} />}
            renderOrder={(order) => (
              <OrderRow
                order={order}
                accounts={accounts}
                busyId={busyId}
                onOpen={() => setOpenOrderId(order.id)}
                onResendConfirmation={onResendConfirmation}
                onOrderAction={onOrderAction}
              />
            )}
          />
        ))}
      </div>
      <PaginationControls
        page={groupsPage.page}
        totalPages={groupsPage.totalPages}
        totalItems={groupsPage.totalItems}
        itemLabel={`cliente(s) · ${filteredOrders.length} pedido(s)`}
        onPageChange={setPage}
      />

      {/* Abandoned checkouts (collapsible) */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <button
          onClick={() => setShowCheckouts((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#1a2730]"
        >
          <Truck size={17} className="shrink-0 text-[#00a884]" />
          <span className="flex-1">
            <span className="block font-semibold dark:text-[#e9edef]">Carrinhos abandonados e rascunhos</span>
            <span className="block text-xs text-[#667781]">Ainda não são pedidos — o cliente não concluiu a compra</span>
          </span>
          {draftCount > 0 && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" title="Rascunhos (draft orders) não confirmados">
              {draftCount} rascunho(s)
            </span>
          )}
          {abandonedCheckouts.length - draftCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="Checkouts da Shopify abandonados">
              {abandonedCheckouts.length - draftCount} checkout(s)
            </span>
          )}
          {showCheckouts ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
        </button>

        {showCheckouts && (
          <div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#f0f2f5] px-5 py-3 dark:border-[#2a3942]">
              {([
                ['', 'Todos'],
                ['draft_order', 'Rascunhos'],
                ['checkout', 'Checkouts'],
              ] as const).map(([value, label]) => (
                <button
                  key={label}
                  onClick={() => { setCheckoutSourceFilter(value); setCheckoutPage(1) }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    checkoutSourceFilter === value
                      ? 'bg-[#00a884] text-white'
                      : 'bg-[#f0f2f5] text-[#667781] hover:bg-[#e6e9ec] dark:bg-[#2a3942] dark:text-[#e9edef]'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto text-xs text-[#667781]">
                Rascunho: pedido do formulário que o cliente não confirmou. Checkout: saiu do checkout da Shopify.
              </span>
            </div>
            <div className="hidden border-t border-[#f0f2f5] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:border-[#2a3942] sm:grid sm:grid-cols-[1.5fr_1fr_1fr_auto]">
              <span>Cliente</span>
              <span>Total / Loja</span>
              <span>Recuperação</span>
              <span>Ação</span>
            </div>
            {visibleCheckouts.length === 0 && (
              <p className="p-6 text-center text-sm text-[#667781]">
                {checkoutSourceFilter === 'draft_order' ? 'Nenhum rascunho aberto.' : 'Nenhum carrinho abandonado.'}
              </p>
            )}
            {visibleCheckouts.map((checkout) => (
              <div
                key={checkout.id}
                className="grid items-center gap-3 border-t border-[#f0f2f5] px-5 py-4 text-sm dark:border-[#2a3942] sm:grid-cols-[1.5fr_1fr_1fr_auto]"
              >
                <div>
                  <div className="mb-1">
                    {checkout.source === 'draft_order' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400" title="Rascunho (draft order) — ainda não é um pedido">
                        <FilePen size={11} />
                        Rascunho{checkout.shopify_name ? ` ${checkout.shopify_name}` : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400" title="Checkout da Shopify abandonado">
                        <ShoppingCart size={11} />
                        Checkout
                      </span>
                    )}
                  </div>
                  <span className="font-semibold dark:text-[#e9edef]">{checkout.customer_name || checkout.email || 'Sem nome'}</span>
                  {checkout.is_simulation && <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">simulação</span>}
                  <p className="text-xs text-[#667781]">{checkout.contact_phone || 'Sem tel.'} · {checkout.country}</p>
                </div>
                <div>
                  <span className="dark:text-[#e9edef]">{checkout.currency} {Number(checkout.total).toFixed(2)}</span>
                  <p className="text-xs text-[#667781]">{checkout.shop_domain}</p>
                </div>
                <div>
                  <select
                    value={checkout.recovery_status}
                    disabled={busyId === checkout.id}
                    onChange={(e) => onUpdateCheckout(checkout.id, { recovery_status: e.target.value as AbandonedCheckoutStatus })}
                    className={`${inputClass} w-full`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {ABANDONED_CHECKOUT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  {checkout.last_error && <p className="mt-1 text-xs text-red-600">{checkout.last_error}</p>}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => onRecoverCheckout(checkout.id)}
                    disabled={busyId === checkout.id || checkout.is_simulation || checkout.recovery_status === 'Não enviar'}
                    className={btnPrimary}
                    title="Recuperar via WhatsApp"
                  >
                    {busyId === checkout.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                    Recuperar
                  </button>
                </div>
              </div>
            ))}
            <div className="border-t border-[#f0f2f5] px-4 py-3 empty:hidden dark:border-[#2a3942]">
              <PaginationControls
                page={checkoutsPage.page}
                totalPages={checkoutsPage.totalPages}
                totalItems={checkoutsPage.totalItems}
                itemLabel="carrinho(s)"
                onPageChange={setCheckoutPage}
              />
            </div>
          </div>
        )}
      </div>

      {/* Order edit modal */}
      {openOrder && (
        <OrderEditModal
          order={openOrder}
          accounts={accounts}
          fulfillmentCountries={activeIntegrations.map((integration) => integration.country)}
          shopifyProducts={shopifyProducts}
          onOpenShopifyProducts={onOpenShopifyProducts}
          onClose={() => setOpenOrderId(null)}
          onUpdateStatus={onUpdateOrderStatus}
          onUpdateItems={onUpdateItems}
          onAction={onOrderAction}
          onResendConfirmation={onResendConfirmation}
        />
      )}

      {/* FenixCOD leads modal */}
      {showFenix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFenix(false)}>
          <div
            className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-2xl bg-white shadow-2xl dark:bg-[#111b21]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
              <Search size={17} className="text-[#00a884]" />
              <h2 className="flex-1 font-bold dark:text-[#e9edef]">Leads externos FenixCOD</h2>
              {fenixFetchedAt && (
                <span className="text-xs text-[#667781]">
                  {new Date(fenixFetchedAt).toLocaleTimeString('pt-BR')}
                </span>
              )}
              <button onClick={() => setShowFenix(false)} className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-[#f0f2f5] px-6 py-3 dark:border-[#2a3942]">
              <select value={fenixCountry} onChange={(e) => setFenixCountry(e.target.value)} className={inputClass}>
                {activeIntegrations.map((i) => (
                  <option key={i.id} value={i.country}>{i.country} · {i.environment}</option>
                ))}
              </select>
              <button onClick={loadFenixLeads} disabled={fenixBusy || !fenixCountry} className={btnPrimary}>
                {fenixBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Consultar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {fenixLeads.length === 0 && (
                <p className="p-8 text-center text-sm text-[#667781]">
                  Selecione um país e clique em Consultar.
                </p>
              )}
              {fenixLeads.map((lead, i) => (
                <div
                  key={`${lead.lead_number}-${i}`}
                  className="flex items-start gap-4 border-b border-[#f0f2f5] px-6 py-4 last:border-0 dark:border-[#2a3942]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="dark:text-[#e9edef]">{lead.lead_number}</b>
                      {localLeadNumbers.has(lead.lead_number) && (
                        <span className="rounded-full bg-[#e7f8f4] px-2 py-0.5 text-xs font-semibold text-[#008f72]">local</span>
                      )}
                      {isFallbackLead(lead) && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">sem número</span>
                      )}
                    </div>
                    <p className="text-sm text-[#667781]">
                      {lead.customer_name || 'Sem nome'} · {lead.contact_phone || 'Sem tel.'}
                    </p>
                    {lead.city && <p className="text-xs text-[#667781]">{lead.city}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {lead.total !== null && (
                      <p className="text-sm dark:text-[#e9edef]">{lead.currency} {Number(lead.total).toFixed(2)}</p>
                    )}
                    <p className="text-xs font-semibold text-[#00a884]">{lead.status || 'desconhecido'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

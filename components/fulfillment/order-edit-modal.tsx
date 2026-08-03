'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, Plus, RefreshCw, Save, Send, Trash2, X, XCircle } from 'lucide-react'
import {
  Account,
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  FulfillmentOrder,
  FulfillmentProduct,
  SEND_STATUSES,
  ShopifyProduct,
  type CommercialStatus,
  type ConfirmationTriggerState,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import ConfirmationTriggerStatus, { getConfirmationTriggerState } from './confirmation-trigger-status'

type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'
type OrderItems = FulfillmentOrder['items']

interface OrderEditModalProps {
  order: FulfillmentOrder
  accounts: Account[]
  fulfillmentCountries: string[]
  shopifyProducts: ShopifyProduct[]
  onOpenShopifyProducts: () => void
  onClose: () => void
  onUpdateStatus: (id: string, patch: {
    country?: string
    commercial_status?: CommercialStatus
    send_status?: SendStatus
    delivery_status?: DeliveryStatus
    assigned_instance_name?: string
    confirmation_trigger_state?: ConfirmationTriggerState
  }) => Promise<void>
  onUpdateItems: (id: string, items: OrderItems) => Promise<void>
  onAction: (id: string, action: OrderAction) => Promise<void>
  onResendConfirmation: (orderId: string) => Promise<void>
}

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'
const btnDanger = 'flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40 dark:bg-red-900/20 dark:hover:bg-red-900/30'

function CommercialBadge({ status }: { status: CommercialStatus }) {
  const color = status.startsWith('Confirmado')
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : status === 'Desistiu'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{status}</span>
}

export default function OrderEditModal({
  order, accounts, fulfillmentCountries, shopifyProducts, onOpenShopifyProducts,
  onClose, onUpdateStatus, onUpdateItems, onAction, onResendConfirmation,
}: OrderEditModalProps) {
  const [busy, setBusy] = useState(false)
  const [draftItems, setDraftItems] = useState<OrderItems>(order.items)
  const [itemsBusy, setItemsBusy] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [catalogProducts, setCatalogProducts] = useState<FulfillmentProduct[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogAllCountries, setCatalogAllCountries] = useState(false)
  const availableCountries = [...new Set(fulfillmentCountries)].sort()
  const rawLineItems = Array.isArray(order.raw_shopify_payload?.line_items)
    ? order.raw_shopify_payload.line_items.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    : []
  const skuIssues = order.source === 'shopify'
    ? draftItems.filter((item, index) => {
      const rawItem = rawLineItems.find((candidate) => {
        const variantId = String(candidate.variant_id ?? '')
        const productId = String(candidate.product_id ?? '')
        return Boolean(
          (item.shopify_variant_id && variantId === item.shopify_variant_id) ||
          (item.shopify_product_id && productId === item.shopify_product_id) ||
          item.product_id === variantId ||
          item.product_id === productId
        )
      }) ?? rawLineItems[index] ?? {}
      const variantId = item.shopify_variant_id || String(rawItem.variant_id ?? '')
      const productId = item.shopify_product_id || String(rawItem.product_id ?? '')
      const catalogSku = shopifyProducts.find((product) =>
        product.shopify_integration_id === order.shopify_integration_id &&
        product.shopify_variant_id === variantId
      )?.sku?.trim()
      const storedSku = item.sku.trim()
      const storedSkuIsIdentifier = storedSku === variantId ||
        storedSku === productId ||
        storedSku.startsWith('SHOPIFY-')
      return !(catalogSku || (storedSku && !storedSkuIsIdentifier))
    })
    : []

  useEffect(() => {
    setDraftItems(order.items)
  }, [order.id, order.items])

  const hasLead = Boolean(order.lead_number)
  const hasCountryIntegration = availableCountries.includes(order.country)
  const canSubmit = !hasLead &&
    hasCountryIntegration &&
    skuIssues.length === 0 &&
    ['pending_operator', 'failed'].includes(order.status) &&
    !order.is_simulation
  const canCancelLocal = !hasLead && order.status === 'pending_operator' && order.source === 'manual'
  const canEditItems = !hasLead
  const itemsDirty = canEditItems && JSON.stringify(draftItems) !== JSON.stringify(order.items)
  const accountLabel = accounts.find((a) => a.instanceName === (order.assigned_instance_name || order.instance_name))?.label
  const isSandboxOrder = (order.assigned_instance_name || order.instance_name) === SANDBOX_INSTANCE_NAME
  // Sandbox test orders can re-run the confirmation trigger repeatedly; real
  // simulations (not tied to the sandbox) stay blocked from ever sending.
  const canResend = order.source === 'shopify' && (!order.confirmation_message_sent_at || (order.is_simulation && isSandboxOrder))

  async function handleUpdate(patch: Parameters<typeof onUpdateStatus>[1]) {
    setBusy(true)
    await onUpdateStatus(order.id, patch)
    setBusy(false)
  }

  async function handleCountryChange(country: string) {
    if (!country || country === order.country) return
    if (!window.confirm(`Alterar o país de fulfillment deste pedido de ${order.country} para ${country}?`)) return
    await handleUpdate({ country })
  }

  async function handleAction(action: OrderAction) {
    if (action === 'submit' && !window.confirm('Enviar este pedido para o FenixCOD agora?')) return
    if (action === 'cancel' && !window.confirm('Esta ação cancelará o pedido real no FenixCOD. Continuar?')) return
    if (action === 'cancel-local' && !window.confirm('Cancelar este pedido local antes do envio?')) return
    setBusy(true)
    await onAction(order.id, action)
    setBusy(false)
  }

  async function handleResend() {
    setBusy(true)
    await onResendConfirmation(order.id)
    setBusy(false)
  }

  function updateDraftItem(index: number, patch: { quantity?: number; unit_price?: number }) {
    setDraftItems((items) => items.map((item, i) => {
      if (i !== index) return item
      const quantity = patch.quantity ?? item.quantity
      const unitPrice = patch.unit_price ?? item.unit_price
      return { ...item, quantity, unit_price: unitPrice, total: quantity * unitPrice }
    }))
  }

  function removeDraftItem(index: number) {
    setDraftItems((items) => (items.length > 1 ? items.filter((_, i) => i !== index) : items))
  }

  async function loadCatalogProducts(allCountries: boolean) {
    setCatalogLoading(true)
    const qs = allCountries ? '' : `?country=${encodeURIComponent(order.country)}`
    const json = await fetch(`/api/fulfillment/products${qs}`, { cache: 'no-store' }).then(getJson)
    setCatalogProducts(json.ok ? (json.products ?? []).filter((p: FulfillmentProduct) => p.active) : [])
    setCatalogLoading(false)
  }

  function addProductToDraft(product: FulfillmentProduct) {
    setDraftItems((items) => [
      ...items,
      {
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        quantity: 1,
        unit_price: Number(product.price),
        total: Number(product.price),
      },
    ])
    setShowAddProduct(false)
  }

  async function handleSaveItems() {
    setItemsBusy(true)
    await onUpdateItems(order.id, draftItems)
    setItemsBusy(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-[#111b21]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold dark:text-[#e9edef]">
                {order.shopify_order_name || order.order_number}
              </h2>
              <CommercialBadge status={order.commercial_status} />
              {order.source === 'shopify' && (
                <span className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs font-semibold text-[#667781] dark:bg-[#2a3942]">shopify</span>
              )}
              {order.source === 'manual' && (
                <span className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs font-semibold text-[#667781] dark:bg-[#2a3942]">manual</span>
              )}
              {order.is_simulation && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">simulação</span>
              )}
            </div>
            <p className="text-xs text-[#667781] mt-0.5">
              {order.country} · {order.currency} {Number(order.total).toFixed(2)} · {accountLabel || order.assigned_instance_name || order.instance_name || 'sem conta'}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
            <X size={18} />
          </button>
        </div>

        <div className="divide-y divide-[#f0f2f5] dark:divide-[#2a3942]">
          {/* Customer + Status */}
          <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">Cliente</p>
              <p className="font-semibold dark:text-[#e9edef]">{order.customer_name}</p>
              <p className="text-sm text-[#667781]">{order.contact_phone || 'Sem telefone'}</p>
              <p className="text-sm text-[#667781]">{order.city}{order.province ? `, ${order.province}` : ''}</p>
              {order.address && <p className="text-sm text-[#667781]">{order.address}{order.zipcode ? ` · ${order.zipcode}` : ''}</p>}
              {order.email && <p className="text-xs text-[#667781] mt-1">{order.email}</p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Status</p>
              <div>
                <label className="mb-0.5 block text-xs text-[#667781]">País de fulfillment</label>
                <select
                  disabled={busy || hasLead}
                  value={order.country}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className={`${inputClass} ${hasCountryIntegration ? '' : 'border-red-400'}`}
                >
                  {!hasCountryIntegration && (
                    <option value={order.country}>{order.country} · sem integração</option>
                  )}
                  {availableCountries.map((country) => <option key={country} value={country}>{country}</option>)}
                </select>
                {!hasCountryIntegration && (
                  <p className="mt-1 text-xs text-red-600">
                    O endereço do Shopify usa {order.country}, mas não há integração FenixCOD ativa para esse país.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-[#667781]">Comercial</label>
                <select
                  disabled={busy}
                  value={order.commercial_status}
                  onChange={(e) => handleUpdate({ commercial_status: e.target.value as CommercialStatus })}
                  className={inputClass}
                >
                  {COMMERCIAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-[#667781]">Envio</label>
                <select
                  disabled={busy}
                  value={order.send_status}
                  onChange={(e) => handleUpdate({ send_status: e.target.value as SendStatus })}
                  className={inputClass}
                >
                  {SEND_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-[#667781]">Entrega</label>
                <select
                  disabled={busy}
                  value={order.delivery_status}
                  onChange={(e) => handleUpdate({ delivery_status: e.target.value as DeliveryStatus })}
                  className={inputClass}
                >
                  {DELIVERY_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-[#667781]">Conta WhatsApp</label>
                <select
                  disabled={busy}
                  value={order.assigned_instance_name || order.instance_name || ''}
                  onChange={(e) => handleUpdate({ assigned_instance_name: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Sem conta</option>
                  {accounts.map((a) => (
                    <option key={a.instanceName} value={a.instanceName}>{a.label || a.instanceName}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Items */}
          {!canEditItems && order.items?.length > 0 && (
            <div className="px-6 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">Itens</p>
              <div className="space-y-1">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="dark:text-[#e9edef]">
                      {item.name || item.sku}
                      <span className="text-[#667781]"> × {item.quantity}</span>
                    </span>
                    <span className="text-[#667781]">{order.currency} {Number(item.total).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEditItems && (
            <div className="px-6 py-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Itens</p>
                {itemsDirty && (
                  <button
                    onClick={handleSaveItems}
                    disabled={itemsBusy}
                    className="flex items-center gap-1.5 rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008f72] disabled:opacity-50"
                  >
                    {itemsBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Salvar itens
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {draftItems.map((item, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#f0f2f5] px-3 py-2 dark:border-[#2a3942]">
                    <span className="min-w-0 flex-1 text-sm dark:text-[#e9edef]" title={item.name || item.sku}>
                      <span className="block truncate">{item.name || item.sku}</span>
                      <span className="block truncate text-xs text-[#667781]">
                        SKU: {item.sku || 'não cadastrado'}
                      </span>
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateDraftItem(i, { quantity: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                      className="w-16 rounded border border-[#d1d7db] bg-white px-1.5 py-1 text-xs dark:border-[#2a3942] dark:bg-[#2a3942] dark:text-[#e9edef]"
                      title="Quantidade"
                    />
                    <span className="text-xs text-[#667781]">×</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateDraftItem(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-24 rounded border border-[#d1d7db] bg-white px-1.5 py-1 text-xs dark:border-[#2a3942] dark:bg-[#2a3942] dark:text-[#e9edef]"
                      title="Preço unitário"
                    />
                    <span className="w-20 shrink-0 text-right text-xs text-[#667781]">
                      {order.currency} {Number(item.total).toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeDraftItem(i)}
                      disabled={draftItems.length <= 1}
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/20"
                      title="Remover item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {skuIssues.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <p className="font-semibold">
                    {skuIssues.length === 1 ? 'Um produto está sem SKU válido.' : `${skuIssues.length} produtos estão sem SKU válido.`}
                  </p>
                  <p className="mt-1">
                    O SKU no Shopify deve ser exatamente o mesmo cadastrado no FenixCOD. Corrija o produto e sincronize o catálogo antes de enviar.
                  </p>
                  <button
                    onClick={onOpenShopifyProducts}
                    className="mt-2 font-semibold text-[#008f72] hover:underline dark:text-[#53d6bd]"
                  >
                    Abrir produtos
                  </button>
                </div>
              )}

              {!showAddProduct ? (
                <button
                  onClick={() => { setShowAddProduct(true); setCatalogAllCountries(false); loadCatalogProducts(false) }}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3 py-1.5 text-xs font-semibold text-[#667781] hover:bg-[#e6e9ec] dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]"
                >
                  <Plus size={12} />Adicionar produto
                </button>
              ) : (
                <div className="mt-2 rounded-lg border border-[#f0f2f5] p-3 dark:border-[#2a3942]">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-[#667781]">Catálogo — {order.country}</p>
                    <button onClick={() => setShowAddProduct(false)} className="text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef]">
                      <X size={14} />
                    </button>
                  </div>
                  {catalogLoading && <p className="text-xs text-[#667781]">Carregando catálogo...</p>}
                  {!catalogLoading && catalogProducts.length === 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-[#667781]">
                        Nenhum produto cadastrado para {order.country}.
                      </p>
                      {!catalogAllCountries && (
                        <button
                          onClick={() => { setCatalogAllCountries(true); loadCatalogProducts(true) }}
                          className="text-xs font-semibold text-[#00a884] hover:underline"
                        >
                          Mostrar produtos de todos os países
                        </button>
                      )}
                    </div>
                  )}
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {catalogProducts.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => addProductToDraft(product)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                      >
                        <span className="truncate dark:text-[#e9edef]">
                          {product.name}
                          {catalogAllCountries && <span className="text-xs text-[#667781]"> · {product.country}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-[#667781]">{product.currency} {Number(product.price).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FenixCOD + WhatsApp info */}
          <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">FenixCOD</p>
              {hasLead ? (
                <p className="text-sm font-semibold text-[#00a884]">Lead #{order.lead_number}</p>
              ) : (
                <p className="text-sm text-[#667781]">Não submetido ainda</p>
              )}
              <p className="mt-0.5 text-xs text-[#667781]">{order.status}</p>
              {order.last_error && (
                <p className="mt-1 text-xs text-red-600">{order.last_error}</p>
              )}
              {!hasLead && order.commercial_status.startsWith('Confirmado') && order.send_status === 'Pendente' && !order.is_simulation && (
                <p className="mt-1 text-xs font-semibold text-amber-600">Pronto para envio automático</p>
              )}
            </div>
            {order.source === 'shopify' && (
              <div className="space-y-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">Gatilho de confirmação</p>
                <ConfirmationTriggerStatus order={order} />
                <select
                  disabled={busy}
                  value={getConfirmationTriggerState(order)}
                  onChange={(event) => handleUpdate({
                    confirmation_trigger_state: event.target.value as ConfirmationTriggerState,
                  })}
                  className={inputClass}
                  aria-label="Estado do gatilho de confirmacao"
                >
                  <option value="pending">Pendente</option>
                  <option value="sent">Disparado</option>
                  <option value="failed">Falhou</option>
                </select>
                {order.confirmation_message_sent_at && (
                  <p className="text-xs text-[#667781]">
                    {new Date(order.confirmation_message_sent_at).toLocaleString('pt-BR')}
                  </p>
                )}
                {order.confirmation_message_error && (
                  <p className="text-xs text-red-500">{order.confirmation_message_error}</p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 px-6 py-4">
            {busy && <Loader2 size={16} className="animate-spin text-[#00a884]" />}
            {canResend && (
              <button
                onClick={handleResend}
                disabled={busy || (order.is_simulation && !isSandboxOrder)}
                className={btnSecondary}
                title="Roda o gatilho 'Pedido Shopify criado' novamente para este pedido"
              >
                <MessageCircle size={14} />Rodar gatilho
              </button>
            )}
            {canSubmit && (
              <button onClick={() => handleAction('submit')} disabled={busy} className={btnPrimary}>
                <Send size={14} />Enviar ao FenixCOD
              </button>
            )}
            {hasLead && (
              <button onClick={() => handleAction('refresh')} disabled={busy} className={btnSecondary}>
                <RefreshCw size={14} />Atualizar
              </button>
            )}
            {hasLead && order.status !== 'cancelled' && (
              <button onClick={() => handleAction('cancel')} disabled={busy} className={btnDanger}>
                <Trash2 size={14} />Cancelar no FenixCOD
              </button>
            )}
            {canCancelLocal && (
              <button onClick={() => handleAction('cancel-local')} disabled={busy} className={btnDanger}>
                <XCircle size={14} />Cancelar local
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

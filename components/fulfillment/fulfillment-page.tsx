'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, FlaskConical, Loader2, MessageSquareText, Package, PackageSearch, PhoneCall, RefreshCw, Settings2, Zap } from 'lucide-react'
import {
  Account,
  FulfillmentOrder,
  ShopifyAbandonedCheckout,
  ShopifyIntegration,
  ShopifyProduct,
  type AbandonedCheckoutStatus,
  type CommercialStatus,
  type DeliveryStatus,
  type ConfirmationTriggerState,
  type SendStatus,
} from '@/types'
import OrdersSection from '@/components/fulfillment/orders-section'
import QueuePanel from '@/components/fulfillment/queue-panel'
import ShopifyConfig from '@/components/fulfillment/shopify-config'
import FenixCODConfig, { Integration } from '@/components/fulfillment/fenixcod-config'
import ShopifyProductsPanel from '@/components/fulfillment/shopify-products-panel'
import { ShopifyProductFormValues } from '@/components/fulfillment/shopify-product-form'
import ShopifyOrderAccountSettings from '@/components/fulfillment/shopify-order-account-settings'

type Tab = 'queue' | 'orders' | 'products' | 'settings'
type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function FulfillmentPage() {
  const [tab, setTab] = useState<Tab>('queue')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [orders, setOrders] = useState<FulfillmentOrder[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [shopifyIntegrations, setShopifyIntegrations] = useState<ShopifyIntegration[]>([])
  const [abandonedCheckouts, setAbandonedCheckouts] = useState<ShopifyAbandonedCheckout[]>([])
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [shopifyProductsBusyId, setShopifyProductsBusyId] = useState<string | null>(null)
  const [shopifyProductsSyncBusy, setShopifyProductsSyncBusy] = useState(false)
  const [shopifyProductsBulkBusy, setShopifyProductsBulkBusy] = useState(false)
  const [shopifyTriggersEnabled, setShopifyTriggersEnabled] = useState(true)
  const [shopifyTriggersLoaded, setShopifyTriggersLoaded] = useState(false)
  const [shopifyTriggersBusy, setShopifyTriggersBusy] = useState(false)
  const [defaultOrderInstanceName, setDefaultOrderInstanceName] = useState('')
  const [defaultOrderAccountBusy, setDefaultOrderAccountBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const webhookEnsureStartedRef = useRef(false)

  const load = useCallback(async () => {
    const [accountRes, orderRes, integrationRes, shopifyIntRes, checkoutRes, shopifyProductRes, triggerSettingRes, defaultAccountRes] = await Promise.all([
      fetch('/api/accounts', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/orders', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/abandoned-checkouts', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/products', { cache: 'no-store' }).then(getJson),
      fetch('/api/settings/shopify-triggers', { cache: 'no-store' }).then(getJson),
      fetch('/api/settings/shopify-order-account', { cache: 'no-store' }).then(getJson),
    ])
    setAccounts(accountRes.accounts ?? [])
    if (orderRes.ok) setOrders(orderRes.orders ?? [])
    if (integrationRes.ok) setIntegrations(integrationRes.integrations ?? [])
    if (shopifyIntRes.ok) setShopifyIntegrations(shopifyIntRes.integrations ?? [])
    if (checkoutRes.ok) setAbandonedCheckouts(checkoutRes.checkouts ?? [])
    if (shopifyProductRes.ok) setShopifyProducts(shopifyProductRes.products ?? [])
    if (triggerSettingRes.ok) {
      setShopifyTriggersEnabled(triggerSettingRes.enabled !== false)
    }
    if (defaultAccountRes.ok) {
      setDefaultOrderInstanceName(defaultAccountRes.instanceName ?? '')
    }
    setShopifyTriggersLoaded(true)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const refreshOrders = useCallback(async () => {
    const orderRes = await fetch('/api/fulfillment/orders', { cache: 'no-store' }).then(getJson)
    if (orderRes.ok) setOrders(orderRes.orders ?? [])
  }, [])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshOrders()
    }
    // 15s: pedidos novos chegam por webhook, não precisam aparecer no mesmo
    // segundo — e cada recarga é egress do Supabase.
    const interval = window.setInterval(refreshWhenVisible, 15_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshOrders])

  useEffect(() => {
    if (loading || shopifyIntegrations.length === 0 || webhookEnsureStartedRef.current) return
    webhookEnsureStartedRef.current = true
    fetch('/api/fulfillment/shopify/webhooks/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(getJson)
      .then((json) => {
        const failed = Array.isArray(json.results)
          ? json.results.filter((result: { ok?: boolean }) => !result.ok).length
          : 0
        if (!json.ok) {
          setMessage({
            text: failed > 0
              ? `Webhook Shopify não pôde ser ativado em ${failed} loja(s). Verifique a configuração do Shopify.`
              : (json.error ?? 'Não foi possível verificar o webhook Shopify.'),
            error: true,
          })
        }
      })
      .catch(() => {
        setMessage({ text: 'Não foi possível verificar o webhook Shopify.', error: true })
      })
  }, [loading, shopifyIntegrations.length])

  function showResult(json: { ok?: boolean; error?: string }, success: string) {
    setMessage({ text: json.ok ? success : (json.error ?? 'Erro inesperado'), error: !json.ok })
  }

  async function updateOrderStatus(id: string, patch: {
    country?: string
    commercial_status?: CommercialStatus
    send_status?: SendStatus
    delivery_status?: DeliveryStatus
    assigned_instance_name?: string
    confirmation_trigger_state?: ConfirmationTriggerState
  }) {
    setBusyId(id)
    const json = await fetch(`/api/fulfillment/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(getJson)
    const autoMsg = json.autoSubmit?.submitted
      ? ' Enviado automaticamente ao FenixCOD.'
      : json.autoSubmit?.error
        ? ` FenixCOD: ${json.autoSubmit.error}`
        : ''
    showResult(json, `Pedido atualizado.${autoMsg}`)
    await load()
    setBusyId(null)
  }

  async function bulkUpdateOrderStatus(ids: string[], status: CommercialStatus) {
    setBusyId('bulk')
    const json = await fetch('/api/fulfillment/orders/bulk-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, commercial_status: status }),
    }).then(getJson)
    showResult(
      json,
      json.ok
        ? `${json.succeeded ?? 0} pedido(s) atualizado(s).${json.failed ? ` ${json.failed} falharam.` : ''}`
        : 'Falha ao atualizar pedidos selecionados.',
    )
    await load()
    setBusyId(null)
  }

  async function updateOrderItems(id: string, items: FulfillmentOrder['items']) {
    setBusyId(id)
    const json = await fetch(`/api/fulfillment/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).then(getJson)
    showResult(json, 'Itens do pedido atualizados.')
    await load()
    setBusyId(null)
  }

  async function orderAction(id: string, action: OrderAction) {
    setBusyId(id)
    const json = await fetch(`/api/fulfillment/orders/${id}/${action}`, { method: 'POST' }).then(getJson)
    const success = action === 'submit' ? 'Enviado ao FenixCOD.'
      : action === 'refresh' ? 'Pedido atualizado do FenixCOD.'
        : action === 'cancel-local' ? 'Pedido local cancelado.'
          : 'Pedido cancelado no FenixCOD.'
    showResult(json, success)
    await load()
    setBusyId(null)
  }

  async function resendConfirmation(orderId: string) {
    setBusyId(orderId)
    const json = await fetch(`/api/fulfillment/orders/${orderId}/confirmation-message`, { method: 'POST' }).then(getJson)
    showResult(json, 'Confirmação enviada por WhatsApp.')
    await load()
    setBusyId(null)
  }

  async function updateCheckout(id: string, patch: { recovery_status?: AbandonedCheckoutStatus; assigned_instance_name?: string }) {
    setBusyId(id)
    const json = await fetch('/api/fulfillment/shopify/abandoned-checkouts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).then(getJson)
    showResult(json, 'Carrinho atualizado.')
    await load()
    setBusyId(null)
  }

  async function recoverCheckout(id: string) {
    setBusyId(id)
    const json = await fetch(`/api/fulfillment/shopify/abandoned-checkouts/${id}/recover`, { method: 'POST' }).then(getJson)
    showResult(json, 'Mensagem de recuperação enviada.')
    await load()
    setBusyId(null)
  }

  async function syncShopify() {
    setSyncBusy(true)
    const json = await fetch('/api/fulfillment/shopify/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendConfirmation: false }),
    }).then(getJson)
    showResult(
      json,
      json.ok
        ? `Shopify sincronizado: ${json.importedOrders ?? 0} pedido(s), ${json.importedCheckouts ?? 0} carrinho(s).`
        : 'Falha ao sincronizar Shopify.',
    )
    await load()
    setSyncBusy(false)
  }

  async function toggleKeepLocalCopy(product: ShopifyProduct, enabled: boolean) {
    setShopifyProductsBusyId(product.id)
    const json = await fetch('/api/fulfillment/shopify/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, keep_local_copy: enabled }),
    }).then(getJson)
    showResult(json, enabled ? 'Cópia local ativada.' : 'Cópia local desativada.')
    await load()
    setShopifyProductsBusyId(null)
  }

  async function bulkToggleKeepLocalCopy(productIds: string[], enabled: boolean) {
    if (shopifyProductsBulkBusy || productIds.length === 0) return
    setShopifyProductsBulkBusy(true)
    try {
      const json = await fetch('/api/fulfillment/shopify/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: productIds, keep_local_copy: enabled }),
      }).then(getJson)
      if (!json.ok) throw new Error(json.error ?? 'Não foi possível atualizar os produtos.')
      showResult(json, `${json.updated ?? productIds.length} produto(s) atualizado(s).`)
      await load()
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Não foi possível atualizar os produtos.',
        error: true,
      })
      throw error
    } finally {
      setShopifyProductsBulkBusy(false)
    }
  }

  async function saveShopifyProduct(values: ShopifyProductFormValues, editingId: string | null) {
    setShopifyProductsBusyId(editingId ?? 'new')
    try {
      const json = await fetch('/api/fulfillment/shopify/products', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          id: editingId ?? undefined,
          price: Number(values.price),
          units_per_pack: Number(values.units_per_pack),
        }),
      }).then(getJson)
      showResult(json, editingId ? 'Produto atualizado.' : 'Produto adicionado.')
      if (!json.ok) throw new Error(json.error ?? 'Não foi possível salvar o produto.')
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar o produto.'
      setMessage({ text: message, error: true })
      throw error
    } finally {
      setShopifyProductsBusyId(null)
    }
  }

  async function deleteShopifyProduct(product: ShopifyProduct) {
    setShopifyProductsBusyId(product.id)
    const json = await fetch(`/api/fulfillment/shopify/products?id=${encodeURIComponent(product.id)}`, { method: 'DELETE' }).then(getJson)
    showResult(json, product.source === 'manual' ? 'Produto excluído.' : 'Produto ocultado.')
    await load()
    setShopifyProductsBusyId(null)
  }

  async function syncShopifyProducts() {
    setShopifyProductsSyncBusy(true)
    const json = await fetch('/api/fulfillment/shopify/products/sync', { method: 'POST' }).then(getJson)
    showResult(
      json,
      json.ok
        ? `Produtos sincronizados: ${json.importedProducts ?? 0}.`
        : json.error ?? 'Falha ao sincronizar produtos.',
    )
    await load()
    setShopifyProductsSyncBusy(false)
  }

  async function toggleShopifyTriggers() {
    if (shopifyTriggersBusy || !shopifyTriggersLoaded) return
    const nextEnabled = !shopifyTriggersEnabled
    setShopifyTriggersBusy(true)
    try {
      const json = await fetch('/api/settings/shopify-triggers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      }).then(getJson)
      if (!json.ok) throw new Error(json.error ?? 'Não foi possível alterar os gatilhos Shopify.')
      setShopifyTriggersEnabled(nextEnabled)
      setMessage({
        text: nextEnabled
          ? 'Gatilhos automáticos do Shopify ativados.'
          : 'Gatilhos automáticos do Shopify pausados. Novos pedidos continuarão sendo importados.',
      })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Não foi possível alterar os gatilhos Shopify.',
        error: true,
      })
    } finally {
      setShopifyTriggersBusy(false)
    }
  }

  async function updateDefaultOrderAccount(instanceName: string) {
    if (defaultOrderAccountBusy) return
    setDefaultOrderAccountBusy(true)
    try {
      const json = await fetch('/api/settings/shopify-order-account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: instanceName || null }),
      }).then(getJson)
      if (!json.ok) throw new Error(json.error ?? 'Não foi possível salvar a conta padrão.')
      setDefaultOrderInstanceName(json.instanceName ?? '')
      setMessage({
        text: json.instanceName
          ? 'Conta padrão dos novos pedidos atualizada.'
          : 'Conta padrão removida. A seleção por país será utilizada.',
      })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Não foi possível salvar a conta padrão.',
        error: true,
      })
    } finally {
      setDefaultOrderAccountBusy(false)
    }
  }

  const queueCount = orders.filter((o) => o.commercial_status === 'Não responde' && !o.is_simulation).length

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f8f9fa] dark:bg-[#0b141a]">
      <header className="shrink-0 border-b border-[#d1d7db] bg-white px-6 py-3 dark:border-[#2a3942] dark:bg-[#111b21]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
            title="Voltar"
          >
            <ArrowLeft size={19} />
          </Link>
          <h1 className="flex-1 text-base font-bold text-[#111b21] dark:text-[#e9edef]">
            Pedidos & Fulfillment
          </h1>
          <button
            onClick={load}
            className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
            title="Atualizar"
          >
            {loading
              ? <Loader2 size={17} className="animate-spin text-[#00a884]" />
              : <RefreshCw size={17} />}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {([
              ['queue', 'Fila', PhoneCall],
              ['orders', 'Pedidos', PackageSearch],
              ['products', 'Produtos', Package],
              ['settings', 'Configurações', Settings2],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === id
                    ? 'bg-[#00a884] text-white'
                    : 'text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                }`}
              >
                <Icon size={15} />
                {label}
                {id === 'queue' && queueCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      tab === id ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}
                  >
                    {queueCount}
                  </span>
                )}
              </button>
            ))}
            {/* O Sandbox virou uma aba do menu principal, ao lado dos fluxos
                e gatilhos que ele testa. */}
            <button
              onClick={() => {
                try { localStorage.setItem('activeView', 'sandbox') } catch { /* abre na última aba */ }
                window.location.href = '/'
              }}
              className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
              title="O Sandbox agora fica no menu principal, abaixo de Memória"
            >
              <FlaskConical size={15} />
              Sandbox
              <ArrowUpRight size={13} />
            </button>
          </nav>
          <label className="relative flex min-h-10 min-w-48 max-w-60 shrink-0 items-center">
            <MessageSquareText size={16} className="pointer-events-none absolute left-3 text-[#667781] dark:text-[#aebac1]" />
            <select
              value={defaultOrderInstanceName}
              onChange={(event) => void updateDefaultOrderAccount(event.target.value)}
              disabled={defaultOrderAccountBusy || loading}
              aria-label="Conta padrão dos novos pedidos"
              title="Conta padrão dos novos pedidos Shopify"
              className="min-h-10 w-full rounded-lg border border-[#d1d7db] bg-white py-2 pl-9 pr-8 text-sm font-semibold text-[#54656f] outline-none focus:border-[#00a884] disabled:opacity-60 dark:border-[#3d4f5a] dark:bg-[#111b21] dark:text-[#e9edef]"
            >
              <option value="">Conta por país</option>
              {accounts.filter((account) => !account.isSandbox).map((account) => (
                <option key={account.instanceName} value={account.instanceName}>
                  {account.label || account.instanceName}
                </option>
              ))}
            </select>
            {defaultOrderAccountBusy && <Loader2 size={15} className="pointer-events-none absolute right-8 animate-spin text-[#00a884]" />}
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={shopifyTriggersEnabled}
            onClick={() => void toggleShopifyTriggers()}
            disabled={shopifyTriggersBusy || !shopifyTriggersLoaded}
            className={`flex min-h-10 shrink-0 items-center gap-3 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
              shopifyTriggersEnabled
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-[#d1d7db] bg-[#f0f2f5] text-[#54656f] hover:bg-[#e4e7e9] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#aebac1]'
            }`}
            title="Ativa ou pausa os fluxos disparados por novos pedidos Shopify"
          >
            {shopifyTriggersBusy
              ? <Loader2 size={17} className="animate-spin" />
              : <Zap size={17} />}
            <span>Gatilhos Shopify</span>
            <span className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${
              shopifyTriggersEnabled ? 'bg-[#00a884]' : 'bg-[#8696a0]'
            }`}>
              <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                shopifyTriggersEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </span>
            <span className="min-w-14 text-left text-xs">
              {shopifyTriggersLoaded
                ? shopifyTriggersEnabled ? 'Ativos' : 'Pausados'
                : 'Carregando'}
            </span>
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`mx-6 mt-4 shrink-0 rounded-lg px-4 py-3 text-sm ${
            message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'
          }`}
        >
          {message.text}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="animate-spin text-[#00a884]" />
          </div>
        )}

        {!loading && tab === 'queue' && (
          <QueuePanel
            orders={orders}
            busyId={busyId}
            accounts={accounts}
            integrations={integrations}
            shopifyProducts={shopifyProducts}
            onOpenShopifyProducts={() => setTab('products')}
            onUpdateOrderStatus={updateOrderStatus}
            onUpdateItems={updateOrderItems}
            onOrderAction={orderAction}
            onResendConfirmation={resendConfirmation}
            onBulkUpdateStatus={bulkUpdateOrderStatus}
          />
        )}

        {!loading && tab === 'orders' && (
          <OrdersSection
            orders={orders}
            accounts={accounts}
            abandonedCheckouts={abandonedCheckouts}
            integrations={integrations}
            busyId={busyId}
            syncBusy={syncBusy}
            shopifyIntegrationsCount={shopifyIntegrations.length}
            shopifyProducts={shopifyProducts}
            onSyncShopify={syncShopify}
            onUpdateOrderStatus={updateOrderStatus}
            onUpdateItems={updateOrderItems}
            onOrderAction={orderAction}
            onResendConfirmation={resendConfirmation}
            onUpdateCheckout={updateCheckout}
            onRecoverCheckout={recoverCheckout}
            onOpenShopifyProducts={() => setTab('products')}
          />
        )}

        {!loading && tab === 'products' && (
          <ShopifyProductsPanel
            products={shopifyProducts}
            busyId={shopifyProductsBusyId}
            syncBusy={shopifyProductsSyncBusy}
            bulkBusy={shopifyProductsBulkBusy}
            onSync={syncShopifyProducts}
            onToggleKeepLocalCopy={toggleKeepLocalCopy}
            onBulkToggleKeepLocalCopy={bulkToggleKeepLocalCopy}
            onSave={saveShopifyProduct}
            onDelete={deleteShopifyProduct}
          />
        )}

        {!loading && tab === 'settings' && (
          <div className="space-y-10">
            <ShopifyOrderAccountSettings
              accounts={accounts}
              value={defaultOrderInstanceName}
              busy={defaultOrderAccountBusy}
              onChange={updateDefaultOrderAccount}
            />
            <ShopifyConfig
              shopifyIntegrations={shopifyIntegrations}
              accounts={accounts}
              syncBusy={syncBusy}
              onSync={syncShopify}
              onRefresh={load}
            />
            <FenixCODConfig
              integrations={integrations}
              onRefresh={load}
            />
          </div>
        )}

      </main>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, PackageSearch, RefreshCw, Settings2 } from 'lucide-react'
import {
  Account,
  FulfillmentOrder,
  FulfillmentProduct,
  ShopifyAbandonedCheckout,
  ShopifyIntegration,
  type AbandonedCheckoutStatus,
  type CommercialStatus,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'
import OrdersSection from '@/components/fulfillment/orders-section'
import ShopifyConfig from '@/components/fulfillment/shopify-config'
import FenixCODConfig, { Integration } from '@/components/fulfillment/fenixcod-config'

type Tab = 'orders' | 'settings'
type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function FulfillmentPage() {
  const [tab, setTab] = useState<Tab>('orders')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [orders, setOrders] = useState<FulfillmentOrder[]>([])
  const [products, setProducts] = useState<FulfillmentProduct[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [shopifyIntegrations, setShopifyIntegrations] = useState<ShopifyIntegration[]>([])
  const [abandonedCheckouts, setAbandonedCheckouts] = useState<ShopifyAbandonedCheckout[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [simulationBusy, setSimulationBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const load = useCallback(async () => {
    const [accountRes, orderRes, productRes, integrationRes, shopifyIntRes, checkoutRes] = await Promise.all([
      fetch('/api/accounts', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/orders', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/products', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/abandoned-checkouts', { cache: 'no-store' }).then(getJson),
    ])
    setAccounts(accountRes.accounts ?? [])
    if (orderRes.ok) setOrders(orderRes.orders ?? [])
    if (productRes.ok) setProducts(productRes.products ?? [])
    if (integrationRes.ok) setIntegrations(integrationRes.integrations ?? [])
    if (shopifyIntRes.ok) setShopifyIntegrations(shopifyIntRes.integrations ?? [])
    if (checkoutRes.ok) setAbandonedCheckouts(checkoutRes.checkouts ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function showResult(json: { ok?: boolean; error?: string }, success: string) {
    setMessage({ text: json.ok ? success : (json.error ?? 'Erro inesperado'), error: !json.ok })
  }

  async function updateOrderStatus(id: string, patch: {
    commercial_status?: CommercialStatus
    send_status?: SendStatus
    delivery_status?: DeliveryStatus
    assigned_instance_name?: string
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
      body: JSON.stringify({ sendConfirmation: true }),
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

  async function createSimulation() {
    setSimulationBusy(true)
    const firstCountry = integrations.find((i) => i.active)?.country ?? 'PORTUGAL'
    const json = await fetch('/api/fulfillment/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: firstCountry }),
    }).then(getJson)
    showResult(json, 'Simulação criada. Verifique a aba Pedidos.')
    await load()
    setSimulationBusy(false)
  }

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

        <nav className="mt-2 flex gap-1">
          {([
            ['orders', 'Pedidos', PackageSearch],
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
            </button>
          ))}
        </nav>
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

        {!loading && tab === 'orders' && (
          <OrdersSection
            orders={orders}
            accounts={accounts}
            abandonedCheckouts={abandonedCheckouts}
            integrations={integrations}
            busyId={busyId}
            syncBusy={syncBusy}
            shopifyIntegrationsCount={shopifyIntegrations.length}
            onSyncShopify={syncShopify}
            onUpdateOrderStatus={updateOrderStatus}
            onOrderAction={orderAction}
            onResendConfirmation={resendConfirmation}
            onUpdateCheckout={updateCheckout}
            onRecoverCheckout={recoverCheckout}
          />
        )}

        {!loading && tab === 'settings' && (
          <div className="space-y-10">
            <ShopifyConfig
              shopifyIntegrations={shopifyIntegrations}
              accounts={accounts}
              syncBusy={syncBusy}
              onSync={syncShopify}
              onRefresh={load}
            />
            <FenixCODConfig
              integrations={integrations}
              products={products}
              simulationBusy={simulationBusy}
              onCreateSimulation={createSimulation}
              onRefresh={load}
            />
          </div>
        )}
      </main>
    </div>
  )
}

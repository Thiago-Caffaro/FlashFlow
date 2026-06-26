'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Boxes, CheckCircle, FlaskConical, Loader2, PackageSearch,
  MessageCircle, Pencil, RefreshCw, RotateCcw, Save, Send, Settings2,
  ShieldCheck, ShoppingBag, Trash2, Truck, XCircle,
} from 'lucide-react'
import {
  Account,
  ABANDONED_CHECKOUT_STATUSES,
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  ExternalFulfillmentLead,
  FulfillmentOrder,
  FulfillmentProduct,
  SEND_STATUSES,
  ShopifyAbandonedCheckout,
  ShopifyIntegration,
  type AbandonedCheckoutStatus,
  type CommercialStatus,
  type DeliveryStatus,
  type SendStatus,
} from '@/types'

type Section = 'orders' | 'fenixcod' | 'products' | 'integrations' | 'shopify' | 'tests'
type Integration = {
  id: string
  country: string
  environment: 'test' | 'production'
  active: boolean
  token_expires_at: string | null
}
type ProductForm = {
  country: string
  sku: string
  name: string
  price: string
  currency: string
  active: boolean
}
type IntegrationForm = {
  country: string
  email: string
  password: string
  environment: 'test' | 'production'
  active: boolean
}
type ShopifyIntegrationForm = {
  shop_name: string
  shop_domain: string
  admin_token: string
  webhook_secret: string
  default_country: string
  active: boolean
  confirmation_message_template: string
  recovery_message_template: string
}
type OrderAction = 'submit' | 'refresh' | 'cancel' | 'cancel-local'

const emptyProductForm: ProductForm = { country: '', sku: '', name: '', price: '', currency: 'EUR', active: true }
const emptyIntegrationForm: IntegrationForm = { country: '', email: '', password: '', environment: 'production', active: true }
const emptyShopifyIntegrationForm: ShopifyIntegrationForm = {
  shop_name: '',
  shop_domain: '',
  admin_token: '',
  webhook_secret: '',
  default_country: '',
  active: true,
  confirmation_message_template: '',
  recovery_message_template: '',
}

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const buttonClass = 'flex items-center justify-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const secondaryButtonClass = 'flex items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'
const dangerButtonClass = 'flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40 dark:bg-red-900/20 dark:hover:bg-red-900/30'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

function statusClass(active: boolean) {
  return active
    ? 'bg-[#e7f8f4] text-[#008f72]'
    : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
}

function formatMoney(currency: string, value: number | string) {
  return `${currency} ${Number(value).toFixed(2)}`
}

function isFallbackExternalLead(lead: ExternalFulfillmentLead) {
  return /^external-\d+$/.test(lead.lead_number)
}

function shopifyOrderRef(order: FulfillmentOrder) {
  return order.shopify_order_name || order.order_number
}

function canAutoSubmit(order: FulfillmentOrder) {
  return String(order.commercial_status ?? '').startsWith('Confirmado') &&
    order.send_status === 'Pendente' &&
    !order.lead_number &&
    !order.is_simulation
}

export default function FulfillmentPage() {
  const [section, setSection] = useState<Section>('orders')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [instance, setInstance] = useState('')
  const [orders, setOrders] = useState<FulfillmentOrder[]>([])
  const [externalLeads, setExternalLeads] = useState<ExternalFulfillmentLead[]>([])
  const [products, setProducts] = useState<FulfillmentProduct[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [shopifyIntegrations, setShopifyIntegrations] = useState<ShopifyIntegration[]>([])
  const [abandonedCheckouts, setAbandonedCheckouts] = useState<ShopifyAbandonedCheckout[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [externalCountry, setExternalCountry] = useState('')
  const [externalBusy, setExternalBusy] = useState(false)
  const [externalFetchedAt, setExternalFetchedAt] = useState<string | null>(null)
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [integrationForm, setIntegrationForm] = useState<IntegrationForm>(emptyIntegrationForm)
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null)
  const [shopifyForm, setShopifyForm] = useState<ShopifyIntegrationForm>(emptyShopifyIntegrationForm)
  const [editingShopifyId, setEditingShopifyId] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [simulationBusy, setSimulationBusy] = useState(false)
  const [testForm, setTestForm] = useState({ country: '', sku: '' })
  const [testResult, setTestResult] = useState<unknown>(null)
  const [testBusy, setTestBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const orderQuery = instance ? `?instance=${encodeURIComponent(instance)}` : ''
    const [accountRes, orderRes, productRes, integrationRes, shopifyIntegrationRes, abandonedCheckoutRes] = await Promise.all([
      fetch('/api/accounts', { cache: 'no-store' }).then(getJson),
      fetch(`/api/fulfillment/orders${orderQuery}`, { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/products', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/abandoned-checkouts', { cache: 'no-store' }).then(getJson),
    ])
    setAccounts(accountRes.accounts ?? [])
    if (orderRes.ok) setOrders(orderRes.orders ?? [])
    if (productRes.ok) setProducts(productRes.products ?? [])
    if (integrationRes.ok) setIntegrations(integrationRes.integrations ?? [])
    if (shopifyIntegrationRes.ok) setShopifyIntegrations(shopifyIntegrationRes.integrations ?? [])
    if (abandonedCheckoutRes.ok) setAbandonedCheckouts(abandonedCheckoutRes.checkouts ?? [])
    setLoading(false)
  }, [instance])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const activeIntegrations = integrations.filter((integration) => integration.active)
    if (!externalCountry && activeIntegrations.length) setExternalCountry(activeIntegrations[0].country)
  }, [externalCountry, integrations])

  const localLeadNumbers = useMemo(
    () => new Set(orders.map((order) => order.lead_number).filter((lead): lead is string => Boolean(lead))),
    [orders]
  )
  const activeIntegrations = integrations.filter((integration) => integration.active)

  function showResult(json: { ok?: boolean; error?: string; status?: string }, success: string) {
    setMessage({ text: json.ok ? success : json.error ?? 'Erro inesperado', error: !json.ok })
  }

  function resetProductForm() {
    setProductForm(emptyProductForm)
    setEditingProductId(null)
  }

  function resetIntegrationForm() {
    setIntegrationForm(emptyIntegrationForm)
    setEditingIntegrationId(null)
  }

  function resetShopifyForm() {
    setShopifyForm(emptyShopifyIntegrationForm)
    setEditingShopifyId(null)
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
    const autoMessage = json.autoSubmit?.submitted
      ? ' Pedido enviado automaticamente ao FenixCOD.'
      : json.autoSubmit?.error
        ? ` FenixCOD: ${json.autoSubmit.error}`
        : ''
    showResult(json, `Pedido atualizado.${autoMessage}`)
    await load()
    setBusyId(null)
  }

  async function resendConfirmation(order: FulfillmentOrder) {
    setBusyId(order.id)
    const json = await fetch(`/api/fulfillment/orders/${order.id}/confirmation-message`, { method: 'POST' }).then(getJson)
    showResult(json, 'Mensagem de confirmação enviada.')
    await load()
    setBusyId(null)
  }

  async function updateAccountRouting(account: Account, patch: { confirmationEnabled?: boolean; confirmationPriority?: number }) {
    setBusyId(account.instanceName)
    const json = await fetch(`/api/accounts/${encodeURIComponent(account.instanceName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(getJson)
    showResult(json, 'Roteamento da conta atualizado.')
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
    showResult(json, json.ok
      ? `Shopify sincronizado: ${json.importedOrders ?? 0} pedido(s), ${json.importedCheckouts ?? 0} carrinho(s).`
      : 'Falha ao sincronizar Shopify.')
    await load()
    setSyncBusy(false)
  }

  async function createSimulation() {
    setSimulationBusy(true)
    const json = await fetch('/api/fulfillment/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: externalCountry || activeIntegrations[0]?.country || 'PORTUGAL' }),
    }).then(getJson)
    showResult(json, 'Pedido e carrinho de simulação criados.')
    await load()
    setSimulationBusy(false)
  }

  async function saveProduct() {
    setMessage(null)
    const payload = { ...productForm, id: editingProductId ?? undefined, price: Number(productForm.price) }
    const res = await fetch('/api/fulfillment/products', {
      method: editingProductId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await getJson(res)
    showResult(json, editingProductId ? 'Produto local atualizado.' : 'Produto local salvo.')
    if (json.ok) {
      resetProductForm()
      await load()
    }
  }

  async function toggleProduct(product: FulfillmentProduct) {
    setBusyId(product.id)
    const res = product.active
      ? await fetch(`/api/fulfillment/products?id=${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, active: true }),
      })
    const json = await getJson(res)
    showResult(json, product.active ? 'Produto local desativado.' : 'Produto local reativado.')
    await load()
    setBusyId(null)
  }

  async function saveIntegration() {
    setMessage(null)
    const res = await fetch('/api/fulfillment/integrations', {
      method: editingIntegrationId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...integrationForm, id: editingIntegrationId ?? undefined }),
    })
    const json = await getJson(res)
    showResult(json, editingIntegrationId ? 'Integração atualizada.' : 'Credenciais validadas e integração salva.')
    if (json.ok) {
      resetIntegrationForm()
      await load()
    }
  }

  async function toggleIntegration(integration: Integration) {
    setBusyId(integration.id)
    const res = integration.active
      ? await fetch(`/api/fulfillment/integrations?id=${encodeURIComponent(integration.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: integration.id, country: integration.country, environment: 'production', active: true }),
      })
    const json = await getJson(res)
    showResult(json, integration.active ? 'Integração desativada.' : 'Integração reativada.')
    await load()
    setBusyId(null)
  }

  async function saveShopifyIntegration() {
    setMessage(null)
    const res = await fetch('/api/fulfillment/shopify/integrations', {
      method: editingShopifyId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...shopifyForm, id: editingShopifyId ?? undefined }),
    })
    const json = await getJson(res)
    showResult(json, editingShopifyId ? 'Integração Shopify atualizada.' : 'Integração Shopify salva.')
    if (json.ok) {
      resetShopifyForm()
      await load()
    }
  }

  async function toggleShopifyIntegration(integration: ShopifyIntegration) {
    setBusyId(integration.id)
    const res = integration.active
      ? await fetch(`/api/fulfillment/shopify/integrations?id=${encodeURIComponent(integration.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/shopify/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: integration.id, active: true }),
      })
    const json = await getJson(res)
    showResult(json, integration.active ? 'Integração Shopify desativada.' : 'Integração Shopify reativada.')
    await load()
    setBusyId(null)
  }

  async function orderAction(id: string, action: OrderAction) {
    if (action === 'submit' && !window.confirm('Enviar este pedido para o FenixCOD agora?')) return
    if (action === 'cancel' && !window.confirm('Esta ação cancelará o pedido real no FenixCOD. Continuar?')) return
    if (action === 'cancel-local' && !window.confirm('Cancelar este pedido local antes do envio?')) return

    setBusyId(id)
    const json = await fetch(`/api/fulfillment/orders/${id}/${action}`, { method: 'POST' }).then(getJson)
    const success = action === 'submit'
      ? 'Pedido enviado para FenixCOD.'
      : action === 'refresh'
        ? 'Pedido atualizado.'
        : action === 'cancel-local'
          ? 'Pedido local cancelado.'
          : 'Pedido real cancelado.'
    showResult(json, success)
    await load()
    setBusyId(null)
  }

  async function loadExternalLeads() {
    setMessage(null)
    if (!externalCountry) {
      setMessage({ text: 'Configure e selecione uma integração ativa antes de consultar o FenixCOD.', error: true })
      return
    }
    setExternalBusy(true)
    const json = await fetch(`/api/fulfillment/external-leads?country=${encodeURIComponent(externalCountry)}`, {
      cache: 'no-store',
    }).then(getJson)
    if (json.ok) {
      const leads = (json.leads ?? []) as ExternalFulfillmentLead[]
      setExternalLeads(leads)
      setExternalFetchedAt(new Date().toISOString())
      setMessage({ text: `${leads.length} lead(s) lidos do FenixCOD. Nenhuma alteração foi enviada.` })
    } else {
      setMessage({ text: json.error ?? 'Erro ao consultar FenixCOD', error: true })
    }
    setExternalBusy(false)
  }

  async function runSafeTest(action: 'connection' | 'countries' | 'stock') {
    setTestBusy(true)
    setTestResult(null)
    const json = await fetch('/api/fulfillment/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...testForm }),
    }).then(getJson)
    setTestResult(json)
    setTestBusy(false)
  }

  const sections: Array<[Section, string, React.ElementType]> = [
    ['orders', 'Confirmação', PackageSearch],
    ['fenixcod', 'FenixCOD', PackageSearch],
    ['products', 'Produtos locais', Boxes],
    ['integrations', 'Integrações', Settings2],
    ['shopify', 'Shopify', ShoppingBag],
    ['tests', 'Testes seguros', FlaskConical],
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f8f9fa] dark:bg-[#0b141a]">
      <header className="shrink-0 border-b border-[#d1d7db] bg-white px-6 py-4 dark:border-[#2a3942] dark:bg-[#111b21]">
        <div className="flex items-center gap-4">
          <Link href="/" className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]" title="Voltar">
            <ArrowLeft size={19} />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-[#111b21] dark:text-[#e9edef]">Pedidos e Fulfillment</h1>
            <p className="text-xs text-[#667781]">Gerenciamento separado do atendimento e dos testes de API.</p>
          </div>
          <button onClick={load} className="ml-auto rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]" title="Atualizar">
            <RefreshCw size={17} />
          </button>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2">
          {sections.map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${section === id ? 'bg-[#00a884] text-white' : 'text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'}`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
      </header>

      {message && (
        <div className={`mx-6 mt-4 shrink-0 rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-6">
        {loading && <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#00a884]" /></div>}

        {!loading && section === 'orders' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
              <strong>Sistema Confirmação:</strong> somente status comercial começando com Confirmado envia ao FenixCOD, quando o envio está Pendente.
              <select value={instance} onChange={(e) => setInstance(e.target.value)} className={`${inputClass} ml-auto max-w-64`}>
                <option value="">Todas as contas</option>
                {accounts.map((account) => <option key={account.instanceName} value={account.instanceName}>{account.label || account.instanceName}</option>)}
              </select>
              <button onClick={syncShopify} disabled={syncBusy || shopifyIntegrations.length === 0} className={buttonClass}>
                {syncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sincronizar Shopify
              </button>
              <button onClick={createSimulation} disabled={simulationBusy} className={secondaryButtonClass}>
                {simulationBusy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
                Simular
              </button>
            </div>
            <div className="overflow-hidden rounded-lg bg-white shadow-sm dark:bg-[#111b21]">
              <div className="grid gap-4 border-b px-5 py-3 text-xs font-semibold uppercase text-[#667781] dark:border-[#2a3942] lg:grid-cols-[1.15fr_1fr_1.4fr_1.1fr_auto]">
                <span>Pedido Shopify</span><span>Cliente</span><span>Confirmação</span><span>Entrega/Fenix</span><span>Ações</span>
              </div>
              {orders.map((order) => {
                const hasLead = Boolean(order.lead_number)
                const canSubmit = !hasLead && ['pending_operator', 'failed'].includes(order.status) && !order.is_simulation
                const canCancelLocal = !hasLead && order.status === 'pending_operator' && order.source === 'manual'
                const accountLabel = accounts.find((account) => account.instanceName === (order.assigned_instance_name || order.instance_name))?.label
                return (
                  <div key={order.id} className="grid gap-4 border-b px-5 py-4 text-sm last:border-0 dark:border-[#2a3942] lg:grid-cols-[1.15fr_1fr_1.4fr_1.1fr_auto]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="dark:text-[#e9edef]">{shopifyOrderRef(order)}</b>
                        {order.is_simulation && <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">simulação</span>}
                        {order.source === 'manual' && <span className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-xs font-semibold text-[#667781] dark:bg-[#2a3942]">manual</span>}
                      </div>
                      <p className="mt-1 text-xs text-[#667781]">{order.country} · {accountLabel || order.assigned_instance_name || order.instance_name || 'sem conta atribuída'}</p>
                      <p className="text-xs text-[#667781]">{formatMoney(order.currency, order.total)}</p>
                    </div>
                    <div>
                      <span className="dark:text-[#e9edef]">{order.customer_name}</span>
                      <p className="text-xs text-[#667781]">{order.contact_phone || 'Sem telefone'}</p>
                      <p className="text-xs text-[#667781]">{order.city} · {order.province}</p>
                    </div>
                    <div className="space-y-2">
                      <select
                        value={order.commercial_status}
                        disabled={busyId === order.id}
                        onChange={(e) => updateOrderStatus(order.id, { commercial_status: e.target.value as CommercialStatus })}
                        className={inputClass}
                      >
                        {COMMERCIAL_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      {order.source === 'shopify' && (
                        order.confirmation_message_sent_at
                          ? <p className="text-xs text-[#00a884]">WA ✓ {new Date(order.confirmation_message_sent_at).toLocaleString('pt-BR')}</p>
                          : order.confirmation_message_error
                            ? <p className="text-xs text-red-500" title={order.confirmation_message_error ?? undefined}>WA falhou</p>
                            : <p className="text-xs text-[#667781]">WA pendente</p>
                      )}
                      <select
                        value={order.send_status}
                        disabled={busyId === order.id}
                        onChange={(e) => updateOrderStatus(order.id, { send_status: e.target.value as SendStatus })}
                        className={inputClass}
                      >
                        {SEND_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <select
                        value={order.assigned_instance_name || order.instance_name || ''}
                        disabled={busyId === order.id}
                        onChange={(e) => updateOrderStatus(order.id, { assigned_instance_name: e.target.value })}
                        className={inputClass}
                      >
                        <option value="">Sem conta</option>
                        {accounts.map((account) => <option key={account.instanceName} value={account.instanceName}>{account.label || account.instanceName}</option>)}
                      </select>
                      {canAutoSubmit(order) && <p className="text-xs font-semibold text-[#00a884]">Pronto para envio automático ao FenixCOD.</p>}
                    </div>
                    <div className="space-y-2">
                      <select
                        value={order.delivery_status}
                        disabled={busyId === order.id}
                        onChange={(e) => updateOrderStatus(order.id, { delivery_status: e.target.value as DeliveryStatus })}
                        className={inputClass}
                      >
                        {DELIVERY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <p className="text-xs font-semibold text-[#00a884]">{order.lead_number ? `Lead ${order.lead_number}` : order.status}</p>
                      {order.last_error && <p className="text-xs text-red-600">{order.last_error}</p>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {order.source === 'shopify' && (
                        <button onClick={() => resendConfirmation(order)} disabled={busyId === order.id || order.is_simulation} className={secondaryButtonClass} title="Enviar confirmação por WhatsApp">
                          {busyId === order.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                        </button>
                      )}
                      {canSubmit && (
                        <button onClick={() => orderAction(order.id, 'submit')} disabled={busyId === order.id} className={buttonClass} title="Enviar para FenixCOD">
                          {busyId === order.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        </button>
                      )}
                      {canCancelLocal && (
                        <button onClick={() => orderAction(order.id, 'cancel-local')} disabled={busyId === order.id} className={secondaryButtonClass} title="Cancelar pedido local">
                          <XCircle size={14} />
                        </button>
                      )}
                      <button onClick={() => orderAction(order.id, 'refresh')} disabled={busyId === order.id || !hasLead} className={secondaryButtonClass} title={hasLead ? 'Consultar pedido real' : 'Disponível após envio'}>
                        <RefreshCw size={14} />
                      </button>
                      <button onClick={() => orderAction(order.id, 'cancel')} disabled={busyId === order.id || !hasLead || order.status === 'cancelled'} className={dangerButtonClass} title={hasLead ? 'Cancelar pedido real' : 'Disponível após envio'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
              {orders.length === 0 && <p className="p-8 text-center text-sm text-[#667781]">Nenhum pedido encontrado.</p>}
            </div>

            <div className="overflow-hidden rounded-lg bg-white shadow-sm dark:bg-[#111b21]">
              <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 dark:border-[#2a3942]">
                <Truck size={18} className="text-[#00a884]" />
                <div>
                  <h2 className="font-bold dark:text-[#e9edef]">Carrinhos abandonados</h2>
                  <p className="text-xs text-[#667781]">{abandonedCheckouts.length} carrinho(s) em fila de recuperação.</p>
                </div>
              </div>
              <div className="grid gap-4 border-b px-5 py-3 text-xs font-semibold uppercase text-[#667781] dark:border-[#2a3942] lg:grid-cols-[1.1fr_1fr_1fr_auto]">
                <span>Cliente</span><span>Total / Loja</span><span>Recuperação</span><span>Ações</span>
              </div>
              {abandonedCheckouts.map((checkout) => (
                <div key={checkout.id} className="grid gap-4 border-b px-5 py-4 text-sm last:border-0 dark:border-[#2a3942] lg:grid-cols-[1.1fr_1fr_1fr_auto]">
                  <div>
                    <b className="dark:text-[#e9edef]">{checkout.customer_name || checkout.email || 'Cliente sem nome'}</b>
                    <p className="text-xs text-[#667781]">{checkout.contact_phone || 'Sem telefone'} · {checkout.country}</p>
                  </div>
                  <div>
                    <span className="dark:text-[#e9edef]">{formatMoney(checkout.currency, checkout.total)}</span>
                    <p className="text-xs text-[#667781]">{checkout.shop_domain}{checkout.is_simulation ? ' · simulação' : ''}</p>
                  </div>
                  <div className="space-y-2">
                    <select
                      value={checkout.recovery_status}
                      disabled={busyId === checkout.id}
                      onChange={(e) => updateCheckout(checkout.id, { recovery_status: e.target.value as AbandonedCheckoutStatus })}
                      className={inputClass}
                    >
                      {ABANDONED_CHECKOUT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <select
                      value={checkout.assigned_instance_name || ''}
                      disabled={busyId === checkout.id}
                      onChange={(e) => updateCheckout(checkout.id, { assigned_instance_name: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Sem conta</option>
                      {accounts.map((account) => <option key={account.instanceName} value={account.instanceName}>{account.label || account.instanceName}</option>)}
                    </select>
                    {checkout.last_error && <p className="text-xs text-red-600">{checkout.last_error}</p>}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => recoverCheckout(checkout.id)}
                      disabled={busyId === checkout.id || checkout.is_simulation || checkout.recovery_status === 'Não enviar'}
                      className={buttonClass}
                      title="Enviar recuperação por WhatsApp"
                    >
                      {busyId === checkout.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                    </button>
                  </div>
                </div>
              ))}
              {abandonedCheckouts.length === 0 && <p className="p-8 text-center text-sm text-[#667781]">Nenhum carrinho abandonado encontrado.</p>}
            </div>
          </section>
        )}

        {!loading && section === 'fenixcod' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-300">
              <strong>Somente leitura:</strong> consulta `GET /api/leads` para comparar os leads do painel FenixCOD.
              <select value={externalCountry} onChange={(e) => setExternalCountry(e.target.value)} className={`${inputClass} ml-auto max-w-64`}>
                <option value="">Selecionar integração...</option>
                {activeIntegrations.map((integration) => <option key={integration.id} value={integration.country}>{integration.country} · {integration.environment}</option>)}
              </select>
              <button disabled={externalBusy || !externalCountry} onClick={loadExternalLeads} className={buttonClass}>
                {externalBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Consultar FenixCOD
              </button>
            </div>
            <div className="rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <h2 className="font-bold dark:text-[#e9edef]">Leads externos do FenixCOD</h2>
                  <p className="text-xs text-[#667781]">
                    Estes registros vêm da API externa e ainda não são gravados como pedidos locais.
                    {externalFetchedAt ? ` Última leitura: ${new Date(externalFetchedAt).toLocaleString('pt-BR')}.` : ''}
                  </p>
                </div>
                <span className="ml-auto rounded-full bg-[#e7f8f4] px-3 py-1 text-xs font-semibold text-[#008f72]">
                  {externalLeads.length} externos
                </span>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg bg-white shadow-sm dark:bg-[#111b21]">
              <div className="grid grid-cols-[1fr_1fr_0.9fr_0.8fr] gap-4 border-b px-5 py-3 text-xs font-semibold uppercase text-[#667781] dark:border-[#2a3942]">
                <span>Referência</span><span>Cliente</span><span>Total / Status</span><span>Origem</span>
              </div>
              {externalLeads.map((lead, index) => (
                <div key={`${lead.country}-${lead.lead_number}-${index}`} className="grid grid-cols-[1fr_1fr_0.9fr_0.8fr] items-start gap-4 border-b px-5 py-4 text-sm last:border-0 dark:border-[#2a3942]">
                  <div>
                    <b className="dark:text-[#e9edef]">{lead.lead_number}</b>
                    <p className="text-xs text-[#667781]">{lead.order_number ? `Pedido ${lead.order_number}` : 'Sem order_number'}</p>
                    {isFallbackExternalLead(lead) && lead.raw && (
                      <details className="mt-2 text-xs text-[#667781]">
                        <summary className="cursor-pointer font-semibold">Dados brutos</summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#0b141a] p-3 text-[#e9edef]">
                          {JSON.stringify(lead.raw, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  <div>
                    <span className="dark:text-[#e9edef]">{lead.customer_name ?? 'Cliente sem nome'}</span>
                    <p className="text-xs text-[#667781]">{lead.contact_phone ?? 'Sem telefone'}{lead.city ? ` · ${lead.city}` : ''}</p>
                  </div>
                  <div>
                    <span className="dark:text-[#e9edef]">{lead.total === null ? 'Total indisponível' : `${lead.currency ?? ''} ${lead.total.toFixed(2)}`.trim()}</span>
                    <p className="text-xs font-semibold text-[#00a884]">{lead.status ?? 'status desconhecido'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-[#f0f2f5] px-2 py-1 text-xs font-semibold text-[#667781] dark:bg-[#2a3942]">FenixCOD</span>
                    {localLeadNumbers.has(lead.lead_number) && <span className="rounded-full bg-[#e7f8f4] px-2 py-1 text-xs font-semibold text-[#008f72]">também local</span>}
                  </div>
                </div>
              ))}
              {externalLeads.length === 0 && (
                <p className="p-8 text-center text-sm text-[#667781]">
                  Nenhum lead externo carregado. Selecione um país integrado e consulte o FenixCOD.
                </p>
              )}
            </div>
          </section>
        )}

        {!loading && section === 'products' && (
          <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="space-y-3 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
              <h2 className="font-bold dark:text-[#e9edef]">{editingProductId ? 'Editar produto local' : 'Mapear produto local'}</h2>
              <p className="text-xs text-[#667781]">Isto apenas associa um SKU externo aos fluxos; não cria produtos no European Fulfillment.</p>
              <input className={inputClass} placeholder="País, ex: PORTUGAL" value={productForm.country} onChange={(e) => setProductForm((form) => ({ ...form, country: e.target.value.toUpperCase() }))} />
              <input className={inputClass} placeholder="SKU externo" value={productForm.sku} onChange={(e) => setProductForm((form) => ({ ...form, sku: e.target.value }))} />
              <input className={inputClass} placeholder="Nome" value={productForm.name} onChange={(e) => setProductForm((form) => ({ ...form, name: e.target.value }))} />
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <input className={inputClass} placeholder="Preço" type="number" min={0} step="0.01" value={productForm.price} onChange={(e) => setProductForm((form) => ({ ...form, price: e.target.value }))} />
                <input className={inputClass} placeholder="Moeda" value={productForm.currency} onChange={(e) => setProductForm((form) => ({ ...form, currency: e.target.value.toUpperCase() }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#667781] dark:text-[#aebac1]">
                <input type="checkbox" checked={productForm.active} onChange={(e) => setProductForm((form) => ({ ...form, active: e.target.checked }))} />
                Ativo
              </label>
              <div className="flex gap-2">
                <button onClick={saveProduct} className={buttonClass}><Save size={14} />{editingProductId ? 'Salvar alterações' : 'Salvar produto local'}</button>
                {editingProductId && <button onClick={resetProductForm} className={secondaryButtonClass}>Cancelar</button>}
              </div>
            </div>
            <div className="space-y-2">
              {products.map((product) => (
                <div key={product.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-sm dark:bg-[#111b21]">
                  <div className="min-w-56 flex-1">
                    <b className="dark:text-[#e9edef]">{product.name}</b>
                    <p className="text-xs text-[#667781]">{product.country} · {product.sku}</p>
                  </div>
                  <span className="font-semibold text-[#00a884]">{formatMoney(product.currency, product.price)}</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(product.active)}`}>{product.active ? 'ativo' : 'inativo'}</span>
                  <button onClick={() => {
                    setEditingProductId(product.id)
                    setProductForm({
                      country: product.country,
                      sku: product.sku,
                      name: product.name,
                      price: String(product.price),
                      currency: product.currency,
                      active: product.active,
                    })
                  }} className={secondaryButtonClass} title="Editar produto"><Pencil size={14} /></button>
                  <button onClick={() => toggleProduct(product)} disabled={busyId === product.id} className={product.active ? dangerButtonClass : secondaryButtonClass} title={product.active ? 'Desativar produto' : 'Reativar produto'}>
                    {product.active ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              ))}
              {products.length === 0 && <p className="rounded-lg bg-white p-8 text-center text-sm text-[#667781] shadow-sm dark:bg-[#111b21]">Nenhum produto local cadastrado.</p>}
            </div>
          </section>
        )}

        {!loading && section === 'integrations' && (
          <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <div className="space-y-3 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
              <h2 className="font-bold dark:text-[#e9edef]">{editingIntegrationId ? 'Editar integração' : 'Configurar credenciais por país'}</h2>
              <p className="text-xs text-[#667781]">Credenciais salvas não são exibidas; preencha e-mail e senha para substituir ou validar mudança de ambiente.</p>
              <input className={inputClass} disabled={Boolean(editingIntegrationId)} placeholder="País, ex: PORTUGAL" value={integrationForm.country} onChange={(e) => setIntegrationForm((form) => ({ ...form, country: e.target.value.toUpperCase() }))} />
              <select className={inputClass} value={integrationForm.environment} onChange={(e) => setIntegrationForm((form) => ({ ...form, environment: e.target.value as 'test' | 'production' }))}>
                <option value="production">Produção</option>
                <option value="test" disabled>Teste documentado</option>
              </select>
              <p className="text-xs text-[#667781]">O host de teste documentado está indisponível/stale; use credenciais de produção.</p>
              <input className={inputClass} placeholder="E-mail" value={integrationForm.email} onChange={(e) => setIntegrationForm((form) => ({ ...form, email: e.target.value }))} />
              <input className={inputClass} type="password" placeholder="Senha" value={integrationForm.password} onChange={(e) => setIntegrationForm((form) => ({ ...form, password: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm text-[#667781] dark:text-[#aebac1]">
                <input type="checkbox" checked={integrationForm.active} onChange={(e) => setIntegrationForm((form) => ({ ...form, active: e.target.checked }))} />
                Ativa
              </label>
              <div className="flex gap-2">
                <button onClick={saveIntegration} className={buttonClass}><Save size={14} />{editingIntegrationId ? 'Salvar alterações' : 'Validar login e salvar'}</button>
                {editingIntegrationId && <button onClick={resetIntegrationForm} className={secondaryButtonClass}>Cancelar</button>}
              </div>
            </div>
            <div className="space-y-2">
              {integrations.map((integration) => (
                <div key={integration.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-sm dark:bg-[#111b21]">
                  <CheckCircle size={18} className={integration.active ? 'text-[#00a884]' : 'text-[#667781]'} />
                  <div className="min-w-52 flex-1">
                    <b className="dark:text-[#e9edef]">{integration.country}</b>
                    <p className="text-xs text-[#667781]">{integration.environment}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(integration.active)}`}>{integration.active ? 'ativa' : 'inativa'}</span>
                  <span className="text-xs text-[#667781]">Token até {integration.token_expires_at ? new Date(integration.token_expires_at).toLocaleString('pt-BR') : '-'}</span>
                  <button onClick={() => {
                    setEditingIntegrationId(integration.id)
                    setIntegrationForm({
                      country: integration.country,
                      email: '',
                      password: '',
                      environment: integration.environment,
                      active: integration.active,
                    })
                  }} className={secondaryButtonClass} title="Editar integração"><Pencil size={14} /></button>
                  <button onClick={() => toggleIntegration(integration)} disabled={busyId === integration.id} className={integration.active ? dangerButtonClass : secondaryButtonClass} title={integration.active ? 'Desativar integração' : 'Reativar integração'}>
                    {integration.active ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              ))}
              {integrations.length === 0 && <p className="rounded-lg bg-white p-8 text-center text-sm text-[#667781] shadow-sm dark:bg-[#111b21]">Nenhuma integração cadastrada.</p>}
            </div>
          </section>
        )}

        {!loading && section === 'shopify' && (
          <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <div className="space-y-6">
              <div className="space-y-3 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
                <h2 className="font-bold dark:text-[#e9edef]">{editingShopifyId ? 'Editar Shopify' : 'Conectar Shopify'}</h2>
                <p className="text-xs text-[#667781]">Token Admin e segredo de webhook são criptografados no servidor.</p>
                <input className={inputClass} placeholder="Nome da loja" value={shopifyForm.shop_name} onChange={(e) => setShopifyForm((form) => ({ ...form, shop_name: e.target.value }))} />
                <input className={inputClass} placeholder="loja.myshopify.com" value={shopifyForm.shop_domain} onChange={(e) => setShopifyForm((form) => ({ ...form, shop_domain: e.target.value.toLowerCase() }))} />
                <input className={inputClass} placeholder={editingShopifyId ? 'Novo Admin API token (opcional)' : 'Admin API token'} value={shopifyForm.admin_token} onChange={(e) => setShopifyForm((form) => ({ ...form, admin_token: e.target.value }))} />
                <input className={inputClass} placeholder={editingShopifyId ? 'Novo webhook secret (opcional)' : 'Webhook secret'} value={shopifyForm.webhook_secret} onChange={(e) => setShopifyForm((form) => ({ ...form, webhook_secret: e.target.value }))} />
                <input className={inputClass} placeholder="País padrão, ex: PORTUGAL" value={shopifyForm.default_country} onChange={(e) => setShopifyForm((form) => ({ ...form, default_country: e.target.value.toUpperCase() }))} />
                <div>
                  <p className="mb-1 text-xs font-semibold text-[#667781]">Mensagem de confirmação de pedido</p>
                  <p className="mb-1 text-xs text-[#667781]">Variáveis: {'{{nome}}'}, {'{{pedido}}'}, {'{{total}}'}, {'{{currency}}'}. Deixe vazio para usar o padrão.</p>
                  <textarea
                    className={`${inputClass} resize-y`}
                    rows={4}
                    placeholder={'Olá, {{nome}}!\nRecebemos seu pedido {{pedido}} no valor de {{currency}} {{total}}.\nResponda esta mensagem para confirmar a entrega e finalizar o envio.'}
                    value={shopifyForm.confirmation_message_template}
                    onChange={(e) => setShopifyForm((form) => ({ ...form, confirmation_message_template: e.target.value }))}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-[#667781]">Mensagem de recuperação de carrinho</p>
                  <p className="mb-1 text-xs text-[#667781]">Variáveis: {'{{nome}}'}, {'{{total}}'}, {'{{currency}}'}, {'{{link}}'}. Deixe vazio para usar o padrão.</p>
                  <textarea
                    className={`${inputClass} resize-y`}
                    rows={4}
                    placeholder={'Olá{{nome}}!\nSeu carrinho de {{currency}} {{total}} ainda está disponível.{{link}}\nResponda esta mensagem se quiser ajuda para finalizar.'}
                    value={shopifyForm.recovery_message_template}
                    onChange={(e) => setShopifyForm((form) => ({ ...form, recovery_message_template: e.target.value }))}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-[#667781] dark:text-[#aebac1]">
                  <input type="checkbox" checked={shopifyForm.active} onChange={(e) => setShopifyForm((form) => ({ ...form, active: e.target.checked }))} />
                  Ativa
                </label>
                <div className="flex gap-2">
                  <button onClick={saveShopifyIntegration} className={buttonClass}><Save size={14} />{editingShopifyId ? 'Salvar alterações' : 'Salvar Shopify'}</button>
                  {editingShopifyId && <button onClick={resetShopifyForm} className={secondaryButtonClass}>Cancelar</button>}
                </div>
              </div>

              <div className="space-y-3 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
                <div className="flex items-center gap-2">
                  <MessageCircle size={17} className="text-[#00a884]" />
                  <h2 className="font-bold dark:text-[#e9edef]">Roteamento WhatsApp</h2>
                </div>
                {accounts.map((account) => (
                  <div key={account.instanceName} className="grid grid-cols-[1fr_88px_96px] items-center gap-2 rounded-lg border border-[#f0f2f5] p-3 dark:border-[#2a3942]">
                    <div>
                      <b className="text-sm dark:text-[#e9edef]">{account.label || account.instanceName}</b>
                      <p className="text-xs text-[#667781]">{account.country || 'sem país'}</p>
                    </div>
                    <label className="flex items-center justify-center gap-2 text-xs text-[#667781]">
                      <input
                        type="checkbox"
                        checked={account.confirmationEnabled ?? true}
                        disabled={busyId === account.instanceName}
                        onChange={(e) => updateAccountRouting(account, { confirmationEnabled: e.target.checked })}
                      />
                      Ativa
                    </label>
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      value={account.confirmationPriority ?? 100}
                      disabled={busyId === account.instanceName}
                      onChange={(e) => updateAccountRouting(account, { confirmationPriority: Number(e.target.value) })}
                      title="Prioridade"
                    />
                  </div>
                ))}
                {accounts.length === 0 && <p className="text-sm text-[#667781]">Nenhuma conta WhatsApp cadastrada.</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
                <ShoppingBag size={20} className="text-[#00a884]" />
                <div>
                  <h2 className="font-bold dark:text-[#e9edef]">Integrações Shopify</h2>
                  <p className="text-xs text-[#667781]">Webhooks de pedidos e carrinhos usam HMAC; sincronização manual lê pedidos recentes.</p>
                </div>
                <button onClick={syncShopify} disabled={syncBusy || shopifyIntegrations.length === 0} className={`${buttonClass} ml-auto`}>
                  {syncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Sincronizar
                </button>
              </div>
              {shopifyIntegrations.map((integration) => (
                <div key={integration.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-sm dark:bg-[#111b21]">
                  <CheckCircle size={18} className={integration.active ? 'text-[#00a884]' : 'text-[#667781]'} />
                  <div className="min-w-64 flex-1">
                    <b className="dark:text-[#e9edef]">{integration.shop_name}</b>
                    <p className="text-xs text-[#667781]">{integration.shop_domain} · {integration.default_country}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(integration.active)}`}>{integration.active ? 'ativa' : 'inativa'}</span>
                  <button onClick={() => {
                    setEditingShopifyId(integration.id)
                    setShopifyForm({
                      shop_name: integration.shop_name,
                      shop_domain: integration.shop_domain,
                      admin_token: '',
                      webhook_secret: '',
                      default_country: integration.default_country,
                      active: integration.active,
                      confirmation_message_template: integration.confirmation_message_template ?? '',
                      recovery_message_template: integration.recovery_message_template ?? '',
                    })
                  }} className={secondaryButtonClass} title="Editar Shopify"><Pencil size={14} /></button>
                  <button onClick={() => toggleShopifyIntegration(integration)} disabled={busyId === integration.id} className={integration.active ? dangerButtonClass : secondaryButtonClass} title={integration.active ? 'Desativar Shopify' : 'Reativar Shopify'}>
                    {integration.active ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              ))}
              {shopifyIntegrations.length === 0 && <p className="rounded-lg bg-white p-8 text-center text-sm text-[#667781] shadow-sm dark:bg-[#111b21]">Nenhuma loja Shopify configurada.</p>}
            </div>
          </section>
        )}

        {!loading && section === 'tests' && (
          <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <div className="space-y-4 rounded-lg bg-white p-5 shadow-sm dark:bg-[#111b21]">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-[#00a884]" />
                <div><h2 className="font-bold dark:text-[#e9edef]">Testes somente leitura</h2><p className="text-xs text-[#667781]">Sem endpoints de criar, atualizar, cancelar ou excluir pedidos.</p></div>
              </div>
              <select className={inputClass} value={testForm.country} onChange={(e) => setTestForm((form) => ({ ...form, country: e.target.value }))}>
                <option value="">Selecionar integração...</option>
                {activeIntegrations.map((integration) => <option key={integration.id} value={integration.country}>{integration.country} · {integration.environment}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={testBusy || !testForm.country} onClick={() => runSafeTest('connection')} className={buttonClass}>Testar conexão</button>
                <button disabled={testBusy || !testForm.country} onClick={() => runSafeTest('countries')} className={buttonClass}>Listar países</button>
              </div>
              <div className="flex gap-2">
                <input className={inputClass} placeholder="SKU para consultar estoque" value={testForm.sku} onChange={(e) => setTestForm((form) => ({ ...form, sku: e.target.value }))} />
                <button disabled={testBusy || !testForm.country || !testForm.sku} onClick={() => runSafeTest('stock')} className={buttonClass}>Estoque</button>
              </div>
            </div>
            <pre className="min-h-80 overflow-auto rounded-lg bg-[#111b21] p-5 text-xs text-[#e9edef] shadow-sm">
              {testBusy ? 'Executando teste seguro...' : JSON.stringify(testResult ?? { info: 'O resultado aparecerá aqui.' }, null, 2)}
            </pre>
          </section>
        )}
      </main>
    </div>
  )
}

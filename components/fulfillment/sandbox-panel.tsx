'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, FlaskConical, GitBranch, Loader2, Package, Pencil, Plus,
  Radio, RotateCcw, Save, Search, Send, ShoppingCart, Trash2, User, X,
} from 'lucide-react'
import { Account, FulfillmentProduct, Message, ShopifyProduct } from '@/types'
import MessageBubble from '@/components/chat/message-bubble'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from '@/lib/sandbox'
import ShopifyProductsTable from './shopify-products-table'
import ShopifyProductForm, { ShopifyProductFormValues } from './shopify-product-form'

interface SandboxPanelProps {
  products: FulfillmentProduct[]
  accounts: Account[]
  onRefresh: () => Promise<void>
  shopifyProducts: ShopifyProduct[]
  shopifyProductsBusyId: string | null
  shopifyProductsSyncBusy: boolean
  onSyncShopifyProducts: () => Promise<void>
  onToggleKeepLocalCopy: (product: ShopifyProduct, enabled: boolean) => Promise<void>
  onSaveShopifyProduct: (values: ShopifyProductFormValues, editingId: string | null) => Promise<void>
  onDeleteShopifyProduct: (product: ShopifyProduct) => Promise<void>
}

type FictitiousProductForm = {
  country: string
  sku: string
  name: string
  price: string
  currency: string
}

const emptyFictitiousProductForm: FictitiousProductForm = { country: '', sku: '', name: '', price: '', currency: 'EUR' }

interface SandboxContact {
  id: string
  wa_id: string
  contact_name: string | null
  contact_phone: string | null
  sandbox_source_instance: string | null
  sandbox_real_send_enabled: boolean
}

interface RealContactResult {
  id: string
  wa_id: string
  instance_name: string
  contact_name: string | null
  contact_phone: string | null
  accountLabel: string
}

type OrderItemForm = { productId: string; quantity: number }

const emptyOrderForm = {
  customerName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  province: '',
  zipcode: '',
  country: '',
  paymentType: 'COD' as 'COD' | 'PREPAID',
}

const PLACEHOLDER_PHONE = '351900000000'

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function SandboxPanel({
  products, accounts, onRefresh,
  shopifyProducts, shopifyProductsBusyId, shopifyProductsSyncBusy,
  onSyncShopifyProducts, onToggleKeepLocalCopy, onSaveShopifyProduct, onDeleteShopifyProduct,
}: SandboxPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [orderForm, setOrderForm] = useState(emptyOrderForm)
  const [orderItems, setOrderItems] = useState<OrderItemForm[]>([])
  const [orderContactId, setOrderContactId] = useState<string | null>(null)
  const [orderBusy, setOrderBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [contacts, setContacts] = useState<SandboxContact[]>([])
  const [activeContactId, setActiveContactId] = useState<string | null>(null)
  const [showAddContact, setShowAddContact] = useState(false)
  const [addMode, setAddMode] = useState<'search' | 'manual'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RealContactResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [addContactBusy, setAddContactBusy] = useState(false)
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null)

  const [showFictitiousForm, setShowFictitiousForm] = useState(false)
  const [fictitiousForm, setFictitiousForm] = useState<FictitiousProductForm>(emptyFictitiousProductForm)
  const [editingFictitiousId, setEditingFictitiousId] = useState<string | null>(null)
  const [fictitiousBusy, setFictitiousBusy] = useState<string | null>(null)
  const [fictitiousCountryFilter, setFictitiousCountryFilter] = useState('')
  const [showRealProductForm, setShowRealProductForm] = useState(false)
  const [editingRealProduct, setEditingRealProduct] = useState<ShopifyProduct | null>(null)
  const [realProductFormBusy, setRealProductFormBusy] = useState(false)

  // Products with keep_local_copy enabled already have a fulfillment_products
  // mirror auto-maintained by the sync — hide those from the manual
  // "fictícios" CRUD below so nobody edits a mirror through the wrong form.
  const mirroredProductIds = new Set(
    shopifyProducts.map((p) => p.local_product_id).filter((id): id is string => Boolean(id))
  )
  const fictitiousProducts = products.filter((p) => !mirroredProductIds.has(p.id))
  const filteredFictitiousProducts = fictitiousCountryFilter
    ? fictitiousProducts.filter((p) => p.country === fictitiousCountryFilter)
    : fictitiousProducts
  const fictitiousCountries = [...new Set(fictitiousProducts.map((p) => p.country))].sort()

  async function saveFictitiousProduct() {
    setFictitiousBusy('form')
    const res = await fetch('/api/fulfillment/products', {
      method: editingFictitiousId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fictitiousForm, id: editingFictitiousId ?? undefined, price: Number(fictitiousForm.price) }),
    })
    const json = await getJson(res)
    showMsg(
      json.ok ? (editingFictitiousId ? 'Produto atualizado.' : 'Produto salvo.') : (json.error ?? 'Erro ao salvar produto.'),
      !json.ok,
    )
    if (json.ok) {
      setFictitiousForm(emptyFictitiousProductForm)
      setEditingFictitiousId(null)
      setShowFictitiousForm(false)
      await onRefresh()
    }
    setFictitiousBusy(null)
  }

  async function toggleFictitiousProduct(product: FulfillmentProduct) {
    setFictitiousBusy(product.id)
    const res = product.active
      ? await fetch(`/api/fulfillment/products?id=${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, active: true }),
      })
    const json = await getJson(res)
    showMsg(
      json.ok ? (product.active ? 'Produto desativado.' : 'Produto reativado.') : (json.error ?? 'Erro.'),
      !json.ok,
    )
    if (json.ok) await onRefresh()
    setFictitiousBusy(null)
  }

  async function handleSaveRealProduct(values: ShopifyProductFormValues) {
    setRealProductFormBusy(true)
    await onSaveShopifyProduct(values, editingRealProduct?.id ?? null)
    setRealProductFormBusy(false)
    setShowRealProductForm(false)
    setEditingRealProduct(null)
  }

  function accountLabel(instanceName: string | null) {
    if (!instanceName) return ''
    return accounts.find((a) => a.instanceName === instanceName)?.label ?? instanceName
  }

  const loadContacts = useCallback(async () => {
    const json = await fetch('/api/fulfillment/sandbox/contacts', { cache: 'no-store' }).then(getJson)
    if (json.ok) {
      const list: SandboxContact[] = json.contacts ?? []
      setContacts(list)
      setActiveContactId((current) => current ?? list[0]?.id ?? null)
    }
  }, [])

  const loadChat = useCallback(async () => {
    const qs = activeContactId ? `?conversationId=${encodeURIComponent(activeContactId)}` : ''
    const json = await fetch(`/api/fulfillment/sandbox/message${qs}`, { cache: 'no-store' }).then(getJson)
    if (json.ok) setMessages(json.messages ?? [])
  }, [activeContactId])

  useEffect(() => { loadContacts() }, [loadContacts])

  useEffect(() => {
    loadChat()
    const interval = setInterval(loadChat, 3000)
    return () => clearInterval(interval)
  }, [loadChat])

  useEffect(() => {
    setOrderContactId(activeContactId)
    const contact = contacts.find((c) => c.id === activeContactId)
    if (contact) {
      setOrderForm((f) => ({
        ...f,
        customerName: contact.contact_name ?? f.customerName,
        phone: contact.contact_phone ?? f.phone,
      }))
    }
  }, [activeContactId, contacts])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function showMsg(text: string, error = false) {
    setMessage({ text, error })
    setTimeout(() => setMessage(null), 5000)
  }

  async function sendChatMessage() {
    const text = chatInput.trim()
    if (!text) return
    setChatBusy(true)
    setChatInput('')
    const json = await fetch('/api/fulfillment/sandbox/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, conversationId: activeContactId }),
    }).then(getJson)
    if (!json.ok) showMsg(json.error ?? 'Erro ao enviar mensagem', true)
    await loadChat()
    setChatBusy(false)
  }

  async function resetSandbox() {
    setResetBusy(true)
    const json = await fetch('/api/fulfillment/sandbox/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeContactId }),
    }).then(getJson)
    showMsg(json.ok ? 'Conversa reiniciada.' : (json.error ?? 'Erro ao reiniciar'), !json.ok)
    await loadChat()
    await onRefresh()
    setResetBusy(false)
  }

  async function searchRealContacts(q: string) {
    setSearchQuery(q)
    if (q.trim().length < 2) { setSearchResults([]); return }
    setSearchBusy(true)
    const json = await fetch(`/api/fulfillment/sandbox/contacts/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' }).then(getJson)
    if (json.ok) setSearchResults(json.contacts ?? [])
    setSearchBusy(false)
  }

  async function createContact(contactName: string, contactPhone: string, sourceInstanceName?: string) {
    setAddContactBusy(true)
    const json = await fetch('/api/fulfillment/sandbox/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactName, contactPhone, sourceInstanceName }),
    }).then(getJson)
    if (json.ok) {
      setShowAddContact(false)
      setSearchQuery('')
      setSearchResults([])
      setManualName('')
      setManualPhone('')
      await loadContacts()
      setActiveContactId(json.contact.id)
    } else {
      showMsg(json.error ?? 'Erro ao adicionar contato', true)
    }
    setAddContactBusy(false)
  }

  async function removeContact(id: string) {
    if (!window.confirm('Remover este contato de teste e todo o histórico dele?')) return
    setRemoveBusyId(id)
    const json = await fetch(`/api/fulfillment/sandbox/contacts/${id}`, { method: 'DELETE' }).then(getJson)
    if (json.ok) {
      await loadContacts()
      setActiveContactId((current) => (current === id ? null : current))
    } else {
      showMsg(json.error ?? 'Erro ao remover contato', true)
    }
    setRemoveBusyId(null)
  }

  async function toggleRealSend(contact: SandboxContact) {
    const json = await fetch(`/api/fulfillment/sandbox/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ realSendEnabled: !contact.sandbox_real_send_enabled }),
    }).then(getJson)
    if (json.ok) await loadContacts()
    else showMsg(json.error ?? 'Erro ao atualizar contato', true)
  }

  function selectOrderContact(id: string) {
    setOrderContactId(id || null)
    const contact = contacts.find((c) => c.id === id)
    if (contact) {
      setOrderForm((f) => ({
        ...f,
        customerName: contact.contact_name ?? f.customerName,
        phone: contact.contact_phone ?? f.phone,
      }))
    }
  }

  function toggleOrderItem(productId: string) {
    setOrderItems((items) => {
      const existing = items.find((item) => item.productId === productId)
      if (existing) return items.filter((item) => item.productId !== productId)
      return [...items, { productId, quantity: 1 }]
    })
  }

  function setOrderItemQuantity(productId: string, quantity: number) {
    setOrderItems((items) => items.map((item) => item.productId === productId ? { ...item, quantity: Math.max(1, quantity) } : item))
  }

  // Fills the form with placeholder data for a quick test, using the real
  // phone of whichever contact is currently active — unless that's the
  // fixed default "Sandbox" contact, which has no real number behind it.
  function fillPlaceholderOrder() {
    const activeContact = contacts.find((c) => c.id === activeContactId) ?? null
    const isRealContact = activeContact && activeContact.wa_id !== SANDBOX_REMOTE_JID
    const phone = (isRealContact ? activeContact?.contact_phone : null) || PLACEHOLDER_PHONE
    setOrderForm({
      customerName: 'Cliente Simulado',
      phone,
      email: '',
      address: 'Rua Exemplo, 123',
      city: 'Cidade Exemplo',
      province: 'Província Exemplo',
      zipcode: '0000-000',
      country: products[0]?.country ?? 'PORTUGAL',
      paymentType: 'COD',
    })
    const firstProduct = products.find((p) => p.active)
    setOrderItems(firstProduct ? [{ productId: firstProduct.id, quantity: 1 }] : [])
    setOrderContactId(activeContactId)
  }

  async function submitShopifyOrder() {
    setOrderBusy(true)
    const items = orderItems.map((item) => {
      const product = products.find((p) => p.id === item.productId)
      return product ? { sku: product.sku, name: product.name, price: product.price, quantity: item.quantity } : null
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    const json = await fetch('/api/fulfillment/sandbox/shopify-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...orderForm, items, conversationId: orderContactId }),
    }).then(getJson)
    showMsg(
      json.ok
        ? (orderContactId ? 'Pedido Shopify simulado criado — abrindo a conversa do contato.' : 'Pedido Shopify simulado criado. Verifique a aba Pedidos.')
        : (json.error ?? 'Erro ao simular pedido'),
      !json.ok,
    )
    if (json.ok) {
      setOrderForm(emptyOrderForm)
      setOrderItems([])
      // Switch the chat panel to the order's contact so the confirmation
      // triggered by the flow is immediately visible, instead of silently
      // landing in whichever contact happened to be selected before.
      if (orderContactId) setActiveContactId(orderContactId)
      else await loadChat()
      await onRefresh()
    }
    setOrderBusy(false)
  }

  const activeContact = contacts.find((c) => c.id === activeContactId) ?? null
  const sandboxAccount = accounts.find((a) => a.isSandbox) ?? null

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e7f8f4]">
          <FlaskConical size={18} className="text-[#00a884]" />
        </div>
        <div className="flex-1">
          <h2 className="font-bold dark:text-[#e9edef]">Sandbox de testes</h2>
          <p className="text-xs text-[#667781]">
            Pedidos nunca são enviados ao FenixCOD real e a loja Shopify real nunca é tocada. Mensagens de WhatsApp só saem de verdade para contatos com envio real ativado (veja o indicador em cada contato abaixo).
          </p>
        </div>
        <button onClick={resetSandbox} disabled={resetBusy} className={btnSecondary} title="Reinicia a conversa e o histórico do contato selecionado">
          {resetBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Reiniciar conversa
        </button>
      </div>

      {/* Contatos de teste */}
      <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold dark:text-[#e9edef]">Contatos de teste</h3>
          <button onClick={() => setShowAddContact((v) => !v)} className={btnSecondary}>
            {showAddContact ? <X size={14} /> : <Plus size={14} />}
            {showAddContact ? 'Fechar' : 'Novo contato'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {contacts.length === 0 && <p className="text-xs text-[#667781]">Nenhum contato de teste ainda.</p>}
          {contacts.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-xs font-semibold transition-colors ${
                activeContactId === c.id
                  ? 'bg-[#00a884] text-white'
                  : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#e9edef]'
              }`}
            >
              <button
                onClick={() => setActiveContactId(c.id)}
                className="flex items-center gap-1.5"
                title={c.sandbox_source_instance ? `Importado da conta: ${accountLabel(c.sandbox_source_instance)}` : 'Contato de teste manual (sem conta real associada)'}
              >
                <User size={12} />
                {c.contact_name || c.contact_phone || 'Sem nome'}
              </button>
              {c.sandbox_source_instance && (
                <button
                  onClick={() => toggleRealSend(c)}
                  title={`Conta: ${accountLabel(c.sandbox_source_instance)} — ${c.sandbox_real_send_enabled ? 'envio real ligado, clique para desligar' : 'envio real desligado, clique para ligar'}`}
                  className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    c.sandbox_real_send_enabled
                      ? 'bg-emerald-500 text-white'
                      : activeContactId === c.id ? 'bg-white/20 text-white' : 'bg-[#e6e9ec] text-[#667781] dark:bg-[#334650]'
                  }`}
                >
                  <Radio size={9} />
                  {c.sandbox_real_send_enabled ? 'real' : 'seguro'}
                </button>
              )}
              <button
                onClick={() => removeContact(c.id)}
                disabled={removeBusyId === c.id}
                title="Remover contato de teste"
                className={activeContactId === c.id ? 'text-white/80 hover:text-white' : 'text-[#aebac1] hover:text-red-500'}
              >
                {removeBusyId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </div>
          ))}
        </div>

        {showAddContact && (
          <div className="mt-4 rounded-lg border border-[#f0f2f5] p-4 dark:border-[#2a3942]">
            <div className="mb-3 flex gap-1">
              <button
                onClick={() => setAddMode('search')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${addMode === 'search' ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942]'}`}
              >
                Importar contato real
              </button>
              <button
                onClick={() => setAddMode('manual')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${addMode === 'manual' ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942]'}`}
              >
                Digitar manualmente
              </button>
            </div>

            {addMode === 'search' ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
                  <input
                    className={`${inputClass} pl-8`}
                    placeholder="Buscar por nome ou telefone em contas conectadas..."
                    value={searchQuery}
                    onChange={(e) => searchRealContacts(e.target.value)}
                  />
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Contatos importados aqui já entram com envio real de WhatsApp ligado — desligue no indicador do contato se quiser só testar a lógica sem notificar a pessoa de verdade.
                </p>
                {searchBusy && <p className="text-xs text-[#667781]">Buscando...</p>}
                {!searchBusy && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <p className="text-xs text-[#667781]">Nenhum contato encontrado em contas conectadas.</p>
                )}
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      disabled={addContactBusy}
                      onClick={() => createContact(c.contact_name || c.contact_phone || 'Sem nome', c.contact_phone || '', c.instance_name)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                    >
                      <span className="dark:text-[#e9edef]">{c.contact_name || 'Sem nome'} · {c.contact_phone}</span>
                      <span className="text-xs text-[#667781]">{c.accountLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <input className={inputClass} placeholder="Nome do contato" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                <input className={inputClass} placeholder="Telefone" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
                <button
                  onClick={() => createContact(manualName.trim(), manualPhone.trim())}
                  disabled={addContactBusy || !manualName.trim() || !manualPhone.trim()}
                  className={btnPrimary}
                >
                  {addContactBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Adicionar contato
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Chat sandbox */}
        <div className="flex h-[520px] flex-col rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
          <div className="flex items-center gap-3 border-b border-[#f0f2f5] px-5 py-3 dark:border-[#2a3942]">
            <div className="flex-1">
              <p className="text-sm font-bold dark:text-[#e9edef]">
                Conversa de teste {activeContact && <span className="font-normal text-[#667781]">· {activeContact.contact_name || activeContact.contact_phone}</span>}
              </p>
              <p className="text-xs text-[#667781]">Fale com o bot como se fosse o cliente. A IA responde de verdade.</p>
            </div>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') localStorage.setItem('activeInstance', SANDBOX_INSTANCE_NAME)
                window.location.href = '/'
              }}
              title="A conta 'Sandbox de testes' precisa de um gatilho apontando para o fluxo desejado, igual a qualquer conta real. Clique para abrir o chat principal com ela selecionada e configurar em Gatilhos."
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-[#667781] hover:bg-[#e6e9ec] dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]"
            >
              <GitBranch size={13} />
              Configurar gatilho
            </button>
          </div>
          {activeContact?.sandbox_real_send_enabled ? (
            <div className="flex items-center gap-2 border-b border-[#f0f2f5] bg-red-50 px-5 py-2 text-xs font-semibold text-red-700 dark:border-[#2a3942] dark:bg-red-900/20 dark:text-red-400">
              <Radio size={12} />
              Envio real ligado — as mensagens desta conversa chegam de verdade no WhatsApp de {activeContact.contact_name || activeContact.contact_phone}, pela conta {accountLabel(activeContact.sandbox_source_instance)}.
            </div>
          ) : (
            <div className="border-b border-[#f0f2f5] bg-amber-50 px-5 py-2 text-xs text-amber-700 dark:border-[#2a3942] dark:bg-amber-900/20 dark:text-amber-400">
              O bot só responde se a conta <b>Sandbox de testes</b> tiver um gatilho configurado apontando para um fluxo — igual a qualquer conta WhatsApp real. Envio real desligado — nada sai pro WhatsApp de verdade nesta conversa.
            </div>
          )}
          <div className="flex-1 space-y-1 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-[#667781]">Nenhuma mensagem ainda. Envie algo abaixo para começar.</p>
            )}
            {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            <div ref={messagesEndRef} />
          </div>
          <div className="flex gap-2 border-t border-[#f0f2f5] p-3 dark:border-[#2a3942]">
            <input
              className={inputClass}
              placeholder="Digite como se fosse o cliente..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !chatBusy) sendChatMessage() }}
            />
            <button onClick={sendChatMessage} disabled={chatBusy || !chatInput.trim()} className={btnPrimary}>
              {chatBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
          {sandboxAccount && (
            <div className="flex items-center gap-1.5 border-t border-[#f0f2f5] px-4 py-2 text-xs text-[#667781] dark:border-[#2a3942] dark:text-[#8696a0]">
              <FlaskConical size={12} className="shrink-0 text-[#00a884]" />
              Conta de teste: <span className="font-semibold text-[#111b21] dark:text-[#e9edef]">{sandboxAccount.label}</span>
            </div>
          )}
        </div>

        {/* Simular pedido Shopify */}
        <div className="space-y-3">
          <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
            <h3 className="mb-1 text-sm font-bold dark:text-[#e9edef]">Simular pedido Shopify</h3>
            <p className="mb-4 text-xs text-[#667781]">
              Monta um pedido no formato real de webhook do Shopify e roda o mesmo código de processamento — sem nunca chamar a loja real.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Atrelar ao contato de teste</label>
                <select className={inputClass} value={orderContactId ?? ''} onChange={(e) => selectOrderContact(e.target.value)}>
                  <option value="">Nenhum (não atrela a um contato)</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.contact_name || c.contact_phone}</option>
                  ))}
                </select>
              </div>
              <input className={inputClass} placeholder="Nome do cliente" value={orderForm.customerName}
                onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder="Telefone" value={orderForm.phone}
                  onChange={(e) => setOrderForm((f) => ({ ...f, phone: e.target.value }))} />
                <input className={inputClass} placeholder="E-mail (opcional)" value={orderForm.email}
                  onChange={(e) => setOrderForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <input className={inputClass} placeholder="Endereço" value={orderForm.address}
                onChange={(e) => setOrderForm((f) => ({ ...f, address: e.target.value }))} />
              <div className="grid grid-cols-3 gap-2">
                <input className={inputClass} placeholder="Cidade" value={orderForm.city}
                  onChange={(e) => setOrderForm((f) => ({ ...f, city: e.target.value }))} />
                <input className={inputClass} placeholder="Província" value={orderForm.province}
                  onChange={(e) => setOrderForm((f) => ({ ...f, province: e.target.value }))} />
                <input className={inputClass} placeholder="CEP" value={orderForm.zipcode}
                  onChange={(e) => setOrderForm((f) => ({ ...f, zipcode: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder="País, ex: SPAIN" value={orderForm.country}
                  onChange={(e) => setOrderForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} />
                <select className={inputClass} value={orderForm.paymentType}
                  onChange={(e) => setOrderForm((f) => ({ ...f, paymentType: e.target.value === 'PREPAID' ? 'PREPAID' : 'COD' }))}>
                  <option value="COD">COD</option>
                  <option value="PREPAID">PREPAID</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold text-[#667781]">Produtos</p>
                {products.length === 0 ? (
                  <p className="text-xs text-[#667781]">Nenhum produto cadastrado no FenixCOD.</p>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[#f0f2f5] p-2 dark:border-[#2a3942]">
                    {products.filter((p) => p.active).map((product) => {
                      const selected = orderItems.find((item) => item.productId === product.id)
                      return (
                        <div key={product.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={!!selected} onChange={() => toggleOrderItem(product.id)} />
                          <span className="flex-1 truncate dark:text-[#e9edef]">{product.name} ({product.country})</span>
                          {selected && (
                            <input
                              type="number" min={1} value={selected.quantity}
                              onChange={(e) => setOrderItemQuantity(product.id, Number(e.target.value))}
                              className="w-14 rounded border border-[#d1d7db] bg-white px-1 py-0.5 text-xs dark:bg-[#2a3942] dark:text-[#e9edef]"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={submitShopifyOrder}
                  disabled={orderBusy || !orderForm.customerName || !orderForm.phone || !orderForm.address || !orderForm.country || !orderItems.length}
                  className={btnPrimary}
                >
                  {orderBusy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
                  Simular pedido
                </button>
                <button onClick={fillPlaceholderOrder} disabled={orderBusy} className={btnSecondary} title="Preenche o formulário com dados de teste, usando o telefone do contato selecionado">
                  <FlaskConical size={14} />
                  Preencher com dados de teste
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Produtos */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Produtos fictícios (manuais, só para uso no sandbox) */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
            <button
              onClick={() => setShowFictitiousForm((v) => !v)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#1a2730]"
            >
              <FlaskConical size={16} className="shrink-0 text-[#00a884]" />
              <div className="flex-1">
                <p className="text-sm font-bold dark:text-[#e9edef]">
                  {editingFictitiousId ? 'Editar produto fictício' : 'Produtos fictícios'}
                </p>
                <p className="text-xs text-[#667781]">
                  {fictitiousProducts.length > 0
                    ? `${fictitiousProducts.length} produto(s) fictício(s) — só usados aqui no sandbox`
                    : 'Nenhum produto fictício ainda — clique para criar'}
                </p>
              </div>
              {showFictitiousForm ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
            </button>

            {showFictitiousForm && (
              <div className="space-y-3 border-t border-[#f0f2f5] px-5 py-4 dark:border-[#2a3942]">
                <input
                  className={inputClass}
                  placeholder="País, ex: SPAIN"
                  value={fictitiousForm.country}
                  onChange={(e) => setFictitiousForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))}
                />
                <input
                  className={inputClass}
                  placeholder="SKU"
                  value={fictitiousForm.sku}
                  onChange={(e) => setFictitiousForm((f) => ({ ...f, sku: e.target.value }))}
                />
                <input
                  className={inputClass}
                  placeholder="Nome do produto"
                  value={fictitiousForm.name}
                  onChange={(e) => setFictitiousForm((f) => ({ ...f, name: e.target.value }))}
                />
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <input
                    className={inputClass}
                    placeholder="Preço"
                    type="number"
                    min={0}
                    step="0.01"
                    value={fictitiousForm.price}
                    onChange={(e) => setFictitiousForm((f) => ({ ...f, price: e.target.value }))}
                  />
                  <input
                    className={inputClass}
                    placeholder="EUR"
                    value={fictitiousForm.currency}
                    onChange={(e) => setFictitiousForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveFictitiousProduct}
                    disabled={fictitiousBusy === 'form' || !fictitiousForm.country || !fictitiousForm.sku || !fictitiousForm.name || !fictitiousForm.price}
                    className={btnPrimary}
                  >
                    {fictitiousBusy === 'form' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {editingFictitiousId ? 'Salvar' : 'Adicionar produto'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingFictitiousId(null)
                      setFictitiousForm(emptyFictitiousProductForm)
                      setShowFictitiousForm(false)
                    }}
                    className={btnSecondary}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex-1 text-sm font-semibold dark:text-[#e9edef]">
                Produtos fictícios ({fictitiousProducts.length})
              </span>
              {fictitiousCountries.length > 1 && (
                <select
                  value={fictitiousCountryFilter}
                  onChange={(e) => setFictitiousCountryFilter(e.target.value)}
                  className={`${inputClass} w-auto`}
                >
                  <option value="">Todos</option>
                  {fictitiousCountries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            {filteredFictitiousProducts.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#667781]">Nenhum produto fictício cadastrado.</p>
            ) : (
              <div className="space-y-1.5">
                {filteredFictitiousProducts.map((product) => (
                  <div key={product.id} className="flex items-center gap-2 rounded-lg border border-[#f0f2f5] px-3 py-2.5 dark:border-[#2a3942]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold dark:text-[#e9edef]">{product.name}</p>
                      <p className="text-xs text-[#667781]">{product.country} · {product.sku}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-[#00a884]">
                      {product.currency} {Number(product.price).toFixed(2)}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${product.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'}`}>
                      {product.active ? 'ativo' : 'inativo'}
                    </span>
                    <button
                      onClick={() => {
                        setEditingFictitiousId(product.id)
                        setFictitiousForm({
                          country: product.country,
                          sku: product.sku,
                          name: product.name,
                          price: String(product.price),
                          currency: product.currency,
                        })
                        setShowFictitiousForm(true)
                      }}
                      className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => toggleFictitiousProduct(product)}
                      disabled={fictitiousBusy === product.id}
                      className={`rounded-lg p-1.5 disabled:opacity-40 ${product.active ? 'text-red-500 hover:bg-red-50' : 'text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'}`}
                      title={product.active ? 'Desativar' : 'Reativar'}
                    >
                      {fictitiousBusy === product.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : product.active ? <Trash2 size={13} /> : <RotateCcw size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Produtos reais (Shopify) — mesmas capacidades disponíveis no botão da aba Pedidos */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              <Package size={16} className="shrink-0 text-[#00a884]" />
              <div className="flex-1">
                <p className="text-sm font-bold dark:text-[#e9edef]">Produtos reais (Shopify)</p>
                <p className="text-xs text-[#667781]">
                  {shopifyProducts.length > 0 ? `${shopifyProducts.length} produto(s) sincronizado(s)` : 'Nenhum produto sincronizado ainda'}
                </p>
              </div>
              <button onClick={onSyncShopifyProducts} disabled={shopifyProductsSyncBusy} className={btnSecondary}>
                {shopifyProductsSyncBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Sincronizar
              </button>
              <button
                onClick={() => { setEditingRealProduct(null); setShowRealProductForm((v) => !v) }}
                className={btnPrimary}
              >
                <Plus size={14} />Adicionar
              </button>
            </div>

            {showRealProductForm && (
              <div className="border-t border-[#f0f2f5] px-5 py-4 dark:border-[#2a3942]">
                <ShopifyProductForm
                  editing={editingRealProduct}
                  busy={realProductFormBusy}
                  onSave={handleSaveRealProduct}
                  onCancel={() => { setShowRealProductForm(false); setEditingRealProduct(null) }}
                />
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
            <ShopifyProductsTable
              products={shopifyProducts}
              busyId={shopifyProductsBusyId}
              onToggleKeepLocalCopy={onToggleKeepLocalCopy}
              onEdit={(product) => { setEditingRealProduct(product); setShowRealProductForm(true) }}
              onDelete={onDeleteShopifyProduct}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

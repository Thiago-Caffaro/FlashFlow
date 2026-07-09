'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FlaskConical, GitBranch, Loader2, Plus, RotateCcw, Search, Send, ShoppingCart, Trash2, User, X } from 'lucide-react'
import { FulfillmentProduct, Message } from '@/types'
import MessageBubble from '@/components/chat/message-bubble'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

interface SandboxPanelProps {
  products: FulfillmentProduct[]
  simulationBusy: boolean
  onCreateSimulation: () => Promise<void>
  onRefresh: () => Promise<void>
}

interface SandboxContact {
  id: string
  wa_id: string
  contact_name: string | null
  contact_phone: string | null
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

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function SandboxPanel({ products, simulationBusy, onCreateSimulation, onRefresh }: SandboxPanelProps) {
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

  async function createContact(contactName: string, contactPhone: string) {
    setAddContactBusy(true)
    const json = await fetch('/api/fulfillment/sandbox/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactName, contactPhone }),
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
      json.ok ? 'Pedido Shopify simulado criado. Verifique a aba Pedidos e o chat sandbox.' : (json.error ?? 'Erro ao simular pedido'),
      !json.ok,
    )
    if (json.ok) {
      setOrderForm(emptyOrderForm)
      setOrderItems([])
      await loadChat()
      await onRefresh()
    }
    setOrderBusy(false)
  }

  const activeContact = contacts.find((c) => c.id === activeContactId) ?? null

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
            Ambiente isolado: nenhuma mensagem chega a um WhatsApp real, nenhum pedido é enviado ao FenixCOD, nenhuma loja Shopify real é tocada.
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
              className={`flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2 text-xs font-semibold transition-colors ${
                activeContactId === c.id
                  ? 'bg-[#00a884] text-white'
                  : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#e9edef]'
              }`}
            >
              <button onClick={() => setActiveContactId(c.id)} className="flex items-center gap-1.5">
                <User size={12} />
                {c.contact_name || c.contact_phone || 'Sem nome'}
              </button>
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
                {searchBusy && <p className="text-xs text-[#667781]">Buscando...</p>}
                {!searchBusy && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <p className="text-xs text-[#667781]">Nenhum contato encontrado em contas conectadas.</p>
                )}
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      disabled={addContactBusy}
                      onClick={() => createContact(c.contact_name || c.contact_phone || 'Sem nome', c.contact_phone || '')}
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
              <p className="text-xs text-[#667781]">Fale com o bot como se fosse o cliente. A IA responde de verdade; nada sai para o WhatsApp real.</p>
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
          <div className="border-b border-[#f0f2f5] bg-amber-50 px-5 py-2 text-xs text-amber-700 dark:border-[#2a3942] dark:bg-amber-900/20 dark:text-amber-400">
            O bot só responde se a conta <b>Sandbox de testes</b> tiver um gatilho configurado apontando para um fluxo — igual a qualquer conta WhatsApp real.
          </div>
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

              <button
                onClick={submitShopifyOrder}
                disabled={orderBusy || !orderForm.customerName || !orderForm.phone || !orderForm.address || !orderForm.country || !orderItems.length}
                className={btnPrimary}
              >
                {orderBusy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
                Simular pedido
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
            <h4 className="mb-2 text-sm font-semibold dark:text-[#e9edef]">Simulação rápida</h4>
            <p className="mb-3 text-xs text-[#667781]">
              Cria um pedido e carrinho de teste com dados genéricos, sem formulário. Útil para testar rapidamente a fila de Pedidos.
            </p>
            <button onClick={onCreateSimulation} disabled={simulationBusy} className={btnSecondary}>
              {simulationBusy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
              Criar simulação
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

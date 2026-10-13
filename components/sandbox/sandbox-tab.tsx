'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen, FlaskConical, GitBranch, LayoutGrid, Package, PanelLeftClose, PanelLeftOpen, ShoppingCart, Zap,
} from 'lucide-react'
import { Account, FulfillmentProduct, ItemFocusRequest, SandboxContact, ShopifyProduct } from '@/types'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import TriggersTab from '@/components/sidebar-right/triggers-tab'
import FlowsTab from '@/components/flows/flows-tab'
import MemoryTab from '@/components/memory/memory-tab'
import SandboxChat from './sandbox-chat'
import SandboxContacts from './sandbox-contacts'
import SandboxOverview, { SandboxSection } from './sandbox-overview'
import SandboxOrderSimulator from './sandbox-order-simulator'
import SandboxFictitiousProducts from './sandbox-fictitious-products'
import { getJson } from './sandbox-styles'

interface SandboxTabProps {
  // true quando a view Sandbox está na tela. Nada é carregado nem consultado
  // antes da primeira ativação, e o chat para de consultar ao sair.
  active: boolean
}

type Section = 'overview' | SandboxSection | 'pedido' | 'produtos'

const SECTIONS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: 'overview', label: 'Visão geral', Icon: LayoutGrid },
  { id: 'gatilhos', label: 'Gatilhos', Icon: Zap },
  { id: 'fluxos', label: 'Fluxos', Icon: GitBranch },
  { id: 'memoria', label: 'Memória', Icon: BookOpen },
  { id: 'pedido', label: 'Simular pedido', Icon: ShoppingCart },
  { id: 'produtos', label: 'Produtos fictícios', Icon: Package },
]

// Sub-abas que ocupam a altura toda (têm layout e rolagem próprios).
const FULL_HEIGHT_SECTIONS: Section[] = ['gatilhos', 'fluxos', 'memoria']

const SECTION_STORAGE_KEY = 'sandboxSection'
const CHAT_STORAGE_KEY = 'sandboxChatOpen'

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch { /* armazenamento bloqueado — só perde a preferência */ }
}

function getStoredSection(): Section {
  const stored = readStorage(SECTION_STORAGE_KEY)
  return SECTIONS.some((s) => s.id === stored) ? stored as Section : 'overview'
}

export default function SandboxTab({ active }: SandboxTabProps) {
  const [section, setSection] = useState<Section>('overview')
  const [visited, setVisited] = useState<Set<Section>>(() => new Set(['overview']))
  const [focus, setFocus] = useState<Partial<Record<SandboxSection, ItemFocusRequest>>>({})
  const [chatOpen, setChatOpen] = useState(true)
  const [activated, setActivated] = useState(false)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [products, setProducts] = useState<FulfillmentProduct[]>([])
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([])
  const [contacts, setContacts] = useState<SandboxContact[]>([])
  const [activeContactId, setActiveContactId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    if (active) setActivated(true)
  }, [active])

  // Preferências lidas depois de montar para não divergir do HTML do servidor.
  useEffect(() => {
    const stored = getStoredSection()
    setSection(stored)
    setVisited((prev) => (prev.has(stored) ? prev : new Set(prev).add(stored)))
    setChatOpen(readStorage(CHAT_STORAGE_KEY) !== '0')
  }, [])

  const loadProducts = useCallback(async () => {
    const [productRes, shopifyProductRes] = await Promise.all([
      fetch('/api/fulfillment/products', { cache: 'no-store' }).then(getJson),
      fetch('/api/fulfillment/shopify/products', { cache: 'no-store' }).then(getJson),
    ])
    if (productRes.ok) setProducts(productRes.products ?? [])
    if (shopifyProductRes.ok) setShopifyProducts(shopifyProductRes.products ?? [])
  }, [])

  // `selectId`: undefined mantém o contato ativo, null volta ao primeiro.
  const loadContacts = useCallback(async (selectId?: string | null) => {
    const json = await fetch('/api/fulfillment/sandbox/contacts', { cache: 'no-store' }).then(getJson)
    if (!json.ok) return
    const list: SandboxContact[] = json.contacts ?? []
    setContacts(list)
    setActiveContactId((current) => {
      const wanted = selectId === undefined ? current : selectId
      return wanted && list.some((c) => c.id === wanted) ? wanted : list[0]?.id ?? null
    })
  }, [])

  useEffect(() => {
    if (!activated) return
    void loadContacts()
    void loadProducts()
    fetch('/api/accounts', { cache: 'no-store' })
      .then(getJson)
      .then((json) => setAccounts(json.accounts ?? []))
      .catch(() => { /* rótulos caem no nome da instância */ })
  }, [activated, loadContacts, loadProducts])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [message])

  const showMessage = useCallback((text: string, error = false) => setMessage({ text, error }), [])

  const accountLabel = useCallback((instanceName: string | null) => {
    if (!instanceName) return ''
    return accounts.find((a) => a.instanceName === instanceName)?.label ?? instanceName
  }, [accounts])

  function openSection(next: Section) {
    setSection(next)
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    writeStorage(SECTION_STORAGE_KEY, next)
  }

  function openFromOverview(target: SandboxSection, itemId?: string) {
    if (itemId) setFocus((prev) => ({ ...prev, [target]: { id: itemId, nonce: Date.now() } }))
    openSection(target)
  }

  function setChatVisible(open: boolean) {
    setChatOpen(open)
    writeStorage(CHAT_STORAGE_KEY, open ? '1' : '0')
  }

  const activeContact = contacts.find((c) => c.id === activeContactId) ?? null
  const mounted = (id: Section) => activated && visited.has(id)

  function sectionClass(id: Section) {
    if (section !== id) return 'hidden'
    return FULL_HEIGHT_SECTIONS.includes(id)
      ? 'absolute inset-0 bg-white dark:bg-[#111b21]'
      : 'absolute inset-0 overflow-y-auto p-4 sm:p-6'
  }

  return (
    <div className="flex h-full flex-col bg-[#f0f2f5] dark:bg-[#0b141a]">
      <header className="shrink-0 border-b border-[#d1d7db] bg-white px-4 py-3 dark:border-[#2a3942] dark:bg-[#111b21]">
        <div className="flex items-center gap-2">
          <FlaskConical size={17} className="shrink-0 text-[#00a884]" />
          <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Sandbox</h2>
          <span className="hidden truncate text-xs text-[#667781] sm:inline">· conta de testes, isolada das contas reais</span>
          <button
            onClick={() => setChatVisible(!chatOpen)}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
            title={chatOpen ? 'Recolher a conversa de teste (mais espaço para o editor)' : 'Mostrar a conversa de teste'}
          >
            {chatOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            <span className="hidden sm:inline">{chatOpen ? 'Recolher conversa' : 'Mostrar conversa'}</span>
          </button>
        </div>
        <nav className="mt-2 flex gap-1 overflow-x-auto">
          {SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => openSection(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                section === id
                  ? 'bg-[#00a884] text-white'
                  : 'text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      {message && (
        <div
          role="status"
          className={`mx-4 mt-3 shrink-0 rounded-lg px-4 py-2.5 text-sm ${
            message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72] dark:bg-[#00a884]/15 dark:text-[#00a884]'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {chatOpen && (
          <aside className="flex h-[55vh] w-full shrink-0 flex-col border-b border-[#d1d7db] bg-white dark:border-[#2a3942] dark:bg-[#111b21] lg:h-auto lg:w-[380px] lg:border-b-0 lg:border-r">
            <SandboxContacts
              contacts={contacts}
              activeContactId={activeContactId}
              accountLabel={accountLabel}
              onSelect={setActiveContactId}
              onReload={loadContacts}
              onMessage={showMessage}
            />
            <SandboxChat
              activeContact={activeContact}
              active={active}
              accountLabel={accountLabel}
              onMessage={showMessage}
            />
          </aside>
        )}

        <main className="relative min-h-[50vh] min-w-0 flex-1 lg:min-h-0">
          <div className={sectionClass('overview')}>
            {mounted('overview') && (
              <SandboxOverview
                visible={active && section === 'overview'}
                onOpen={openFromOverview}
                onMessage={showMessage}
              />
            )}
          </div>
          <div className={sectionClass('gatilhos')}>
            {mounted('gatilhos') && <TriggersTab instanceName={SANDBOX_INSTANCE_NAME} focus={focus.gatilhos ?? null} />}
          </div>
          <div className={sectionClass('fluxos')}>
            {mounted('fluxos') && <FlowsTab instanceName={SANDBOX_INSTANCE_NAME} focus={focus.fluxos ?? null} />}
          </div>
          <div className={sectionClass('memoria')}>
            {mounted('memoria') && <MemoryTab instanceName={SANDBOX_INSTANCE_NAME} focus={focus.memoria ?? null} />}
          </div>
          <div className={sectionClass('pedido')}>
            {mounted('pedido') && (
              <SandboxOrderSimulator
                products={products}
                contacts={contacts}
                activeContactId={activeContactId}
                onOrderCreated={(contactId) => {
                  if (contactId) setActiveContactId(contactId)
                  setChatVisible(true)
                }}
                onMessage={showMessage}
              />
            )}
          </div>
          <div className={sectionClass('produtos')}>
            {mounted('produtos') && (
              <SandboxFictitiousProducts
                products={products}
                shopifyProducts={shopifyProducts}
                onRefresh={loadProducts}
                onMessage={showMessage}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

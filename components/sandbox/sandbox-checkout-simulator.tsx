'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShoppingBasket } from 'lucide-react'
import { FulfillmentProduct, SandboxContact } from '@/types'
import { getJson, sandboxBtnPrimary, sandboxInputClass } from './sandbox-styles'

interface SandboxCheckoutSimulatorProps {
  products: FulfillmentProduct[]
  contacts: SandboxContact[]
  activeContactId: string | null
  onCheckoutCreated: (contactId: string, immediate: boolean) => void
  onOpenTriggers: () => void
  onMessage: (text: string, error?: boolean) => void
}

type ItemForm = { productId: string; quantity: number }

export default function SandboxCheckoutSimulator({
  products, contacts, activeContactId, onCheckoutCreated, onOpenTriggers, onMessage,
}: SandboxCheckoutSimulatorProps) {
  const [contactId, setContactId] = useState<string | null>(activeContactId)
  const [customerName, setCustomerName] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [items, setItems] = useState<ItemForm[]>([])
  const [runNow, setRunNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [noTriggerHint, setNoTriggerHint] = useState(false)

  // Acompanha o contato ativo do chat ao lado.
  useEffect(() => {
    setContactId(activeContactId)
    const contact = contacts.find((c) => c.id === activeContactId)
    if (contact?.contact_name) setCustomerName(contact.contact_name)
  }, [activeContactId, contacts])

  useEffect(() => {
    if (!country && products[0]?.country) setCountry(products[0].country)
  }, [products, country])

  const activeProducts = products.filter((p) => p.active)
  const selectedContact = contacts.find((c) => c.id === contactId) ?? null

  function toggleItem(productId: string) {
    setItems((prev) => prev.some((i) => i.productId === productId)
      ? prev.filter((i) => i.productId !== productId)
      : [...prev, { productId, quantity: 1 }])
  }

  async function submit() {
    if (!contactId) return
    setBusy(true)
    setNoTriggerHint(false)
    const payloadItems = items.map((item) => {
      const product = products.find((p) => p.id === item.productId)
      return product ? { sku: product.sku, name: product.name, price: product.price, quantity: item.quantity } : null
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    const json = await fetch('/api/fulfillment/sandbox/abandoned-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: contactId, customerName, email, country, checkoutUrl, immediate: runNow, items: payloadItems }),
    }).then(getJson)

    if (!json.ok) {
      onMessage(json.error ?? 'Erro ao simular carrinho', true)
    } else if (!json.scheduled) {
      setNoTriggerHint(true)
      onMessage('Carrinho simulado criado, mas nenhum gatilho "Carrinho abandonado" da conta sandbox foi agendado.', true)
    } else {
      onMessage(runNow
        ? `Carrinho simulado criado — ${json.scheduled} gatilho(s) disparando agora; acompanhe na conversa ao lado.`
        : `Carrinho simulado criado — ${json.scheduled} gatilho(s) agendado(s) com o delay configurado.`)
      setItems([])
      onCheckoutCreated(contactId, runNow)
    }
    setBusy(false)
  }

  return (
    <div className="max-w-2xl rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
      <h3 className="mb-1 text-sm font-bold dark:text-[#e9edef]">Simular carrinho abandonado</h3>
      <p className="mb-4 text-xs text-[#667781]">
        Cria um carrinho no formato do webhook <code>checkouts/create</code> da Shopify, preso à conta sandbox, e agenda os gatilhos
        &quot;Carrinho abandonado&quot; dela. A loja real nunca é chamada.
      </p>

      <div className="space-y-3">
        <div>
          <label htmlFor="sandbox-checkout-contact" className="mb-1 block text-xs font-semibold text-[#667781]">Contato de teste</label>
          <select
            id="sandbox-checkout-contact"
            className={sandboxInputClass}
            value={contactId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              setContactId(id)
              const contact = contacts.find((c) => c.id === id)
              if (contact?.contact_name) setCustomerName(contact.contact_name)
            }}
          >
            <option value="">Escolha um contato</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.contact_name || c.contact_phone}</option>)}
          </select>
          {selectedContact && (
            <p className="mt-1 text-xs text-[#667781]">
              Telefone do carrinho: {selectedContact.contact_phone || 'sem telefone'}
              {selectedContact.sandbox_real_send_enabled ? ' · envio real ligado' : ' · envio seguro (nada sai pro WhatsApp)'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input className={sandboxInputClass} placeholder="Nome do cliente" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <input className={sandboxInputClass} placeholder="E-mail (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
          <input className={sandboxInputClass} placeholder="País, ex: SPAIN" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          <input className={sandboxInputClass} placeholder="Link do checkout (opcional)" value={checkoutUrl} onChange={(e) => setCheckoutUrl(e.target.value)} />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-[#667781]">Produtos no carrinho</p>
          {activeProducts.length === 0 ? (
            <p className="text-xs text-[#667781]">Nenhum produto ativo — cadastre um em Produtos fictícios.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#f0f2f5] p-2 dark:border-[#2a3942]">
              {activeProducts.map((product) => {
                const selected = items.find((item) => item.productId === product.id)
                return (
                  <div key={product.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!selected} onChange={() => toggleItem(product.id)} aria-label={product.name} />
                    <span className="flex-1 truncate dark:text-[#e9edef]">{product.name} ({product.country}) · {product.currency} {Number(product.price).toFixed(2)}</span>
                    {selected && (
                      <input
                        type="number"
                        min={1}
                        value={selected.quantity}
                        aria-label={`Quantidade de ${product.name}`}
                        onChange={(e) => setItems((prev) => prev.map((i) => i.productId === product.id ? { ...i, quantity: Math.max(1, Number(e.target.value)) } : i))}
                        className="w-14 rounded border border-[#d1d7db] bg-white px-1 py-0.5 text-xs dark:bg-[#2a3942] dark:text-[#e9edef]"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold text-[#667781]">Quando disparar</legend>
          <label className="flex items-start gap-2 text-sm dark:text-[#e9edef]">
            <input type="radio" name="sandbox-checkout-timing" checked={runNow} onChange={() => setRunNow(true)} className="mt-1 accent-[#00a884]" />
            <span>Agora <span className="text-xs text-[#667781]">— ignora o delay do gatilho, para testar o fluxo na hora</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm dark:text-[#e9edef]">
            <input type="radio" name="sandbox-checkout-timing" checked={!runNow} onChange={() => setRunNow(false)} className="mt-1 accent-[#00a884]" />
            <span>Respeitar o delay do gatilho <span className="text-xs text-[#667781]">— como num carrinho real (padrão 60 min)</span></span>
          </label>
        </fieldset>

        {noTriggerHint && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            Crie um gatilho com origem &quot;Carrinho abandonado&quot; apontando para um fluxo na conta sandbox.{' '}
            <button onClick={onOpenTriggers} className="font-semibold underline">Abrir Gatilhos</button>
          </p>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy || !contactId || !country || items.length === 0}
          className={sandboxBtnPrimary}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBasket size={14} />}
          Simular carrinho abandonado
        </button>
      </div>
    </div>
  )
}

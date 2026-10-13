'use client'

import { useEffect, useState } from 'react'
import { FlaskConical, Loader2, ShoppingCart } from 'lucide-react'
import { FulfillmentProduct, SandboxContact } from '@/types'
import { SANDBOX_REMOTE_JID } from '@/lib/sandbox'
import { getJson, sandboxBtnPrimary, sandboxBtnSecondary, sandboxInputClass } from './sandbox-styles'

interface SandboxOrderSimulatorProps {
  products: FulfillmentProduct[]
  contacts: SandboxContact[]
  activeContactId: string | null
  onOrderCreated: (contactId: string | null) => void
  onMessage: (text: string, error?: boolean) => void
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

export default function SandboxOrderSimulator({
  products, contacts, activeContactId, onOrderCreated, onMessage,
}: SandboxOrderSimulatorProps) {
  const [orderForm, setOrderForm] = useState(emptyOrderForm)
  const [orderItems, setOrderItems] = useState<OrderItemForm[]>([])
  const [orderContactId, setOrderContactId] = useState<string | null>(activeContactId)
  const [orderBusy, setOrderBusy] = useState(false)

  // Acompanha o contato ativo do chat ao lado.
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

  // Preenche com dados de teste, usando o telefone real do contato escolhido
  // — exceto o contato fixo "Sandbox", que não tem número de verdade.
  function fillPlaceholderOrder() {
    const contact = contacts.find((c) => c.id === orderContactId) ?? null
    const isRealContact = contact && contact.wa_id !== SANDBOX_REMOTE_JID
    const phone = (isRealContact ? contact?.contact_phone : null) || PLACEHOLDER_PHONE
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
    onMessage(
      json.ok
        ? (orderContactId ? 'Pedido Shopify simulado criado — a confirmação aparece na conversa ao lado.' : 'Pedido Shopify simulado criado. Verifique a aba Pedidos.')
        : (json.error ?? 'Erro ao simular pedido'),
      !json.ok,
    )
    if (json.ok) {
      setOrderForm(emptyOrderForm)
      setOrderItems([])
      onOrderCreated(orderContactId)
    }
    setOrderBusy(false)
  }

  const activeProducts = products.filter((p) => p.active)

  return (
    <div className="max-w-2xl rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
      <h3 className="mb-1 text-sm font-bold dark:text-[#e9edef]">Simular pedido Shopify</h3>
      <p className="mb-4 text-xs text-[#667781]">
        Monta um pedido no formato real de webhook do Shopify e roda o mesmo código de processamento — sem nunca chamar a loja real nem o FenixCOD.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="sandbox-order-contact" className="mb-1 block text-xs font-semibold text-[#667781]">Atrelar ao contato de teste</label>
          <select id="sandbox-order-contact" className={sandboxInputClass} value={orderContactId ?? ''} onChange={(e) => selectOrderContact(e.target.value)}>
            <option value="">Nenhum (não atrela a um contato)</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.contact_name || c.contact_phone}</option>
            ))}
          </select>
        </div>
        <input className={sandboxInputClass} placeholder="Nome do cliente" value={orderForm.customerName}
          onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input className={sandboxInputClass} placeholder="Telefone" value={orderForm.phone}
            onChange={(e) => setOrderForm((f) => ({ ...f, phone: e.target.value }))} />
          <input className={sandboxInputClass} placeholder="E-mail (opcional)" value={orderForm.email}
            onChange={(e) => setOrderForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
        <input className={sandboxInputClass} placeholder="Endereço" value={orderForm.address}
          onChange={(e) => setOrderForm((f) => ({ ...f, address: e.target.value }))} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input className={sandboxInputClass} placeholder="Cidade" value={orderForm.city}
            onChange={(e) => setOrderForm((f) => ({ ...f, city: e.target.value }))} />
          <input className={sandboxInputClass} placeholder="Província" value={orderForm.province}
            onChange={(e) => setOrderForm((f) => ({ ...f, province: e.target.value }))} />
          <input className={sandboxInputClass} placeholder="CEP" value={orderForm.zipcode}
            onChange={(e) => setOrderForm((f) => ({ ...f, zipcode: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className={sandboxInputClass} placeholder="País, ex: SPAIN" value={orderForm.country}
            onChange={(e) => setOrderForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} />
          <select className={sandboxInputClass} value={orderForm.paymentType} aria-label="Tipo de pagamento"
            onChange={(e) => setOrderForm((f) => ({ ...f, paymentType: e.target.value === 'PREPAID' ? 'PREPAID' : 'COD' }))}>
            <option value="COD">COD</option>
            <option value="PREPAID">PREPAID</option>
          </select>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-[#667781]">Produtos</p>
          {activeProducts.length === 0 ? (
            <p className="text-xs text-[#667781]">Nenhum produto ativo — cadastre um em Produtos fictícios.</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#f0f2f5] p-2 dark:border-[#2a3942]">
              {activeProducts.map((product) => {
                const selected = orderItems.find((item) => item.productId === product.id)
                return (
                  <div key={product.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!selected} onChange={() => toggleOrderItem(product.id)} aria-label={product.name} />
                    <span className="flex-1 truncate dark:text-[#e9edef]">{product.name} ({product.country})</span>
                    {selected && (
                      <input
                        type="number" min={1} value={selected.quantity}
                        aria-label={`Quantidade de ${product.name}`}
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

        <div className="flex flex-wrap gap-2">
          <button
            onClick={submitShopifyOrder}
            disabled={orderBusy || !orderForm.customerName || !orderForm.phone || !orderForm.address || !orderForm.country || !orderItems.length}
            className={sandboxBtnPrimary}
          >
            {orderBusy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
            Simular pedido
          </button>
          <button onClick={fillPlaceholderOrder} disabled={orderBusy} className={sandboxBtnSecondary} title="Preenche o formulário com dados de teste, usando o telefone do contato selecionado">
            <FlaskConical size={14} />
            Preencher com dados de teste
          </button>
        </div>
      </div>
    </div>
  )
}

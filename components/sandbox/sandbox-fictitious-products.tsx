'use client'

import { useState } from 'react'
import { Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { FulfillmentProduct, ShopifyProduct } from '@/types'
import { getJson, sandboxBtnPrimary, sandboxBtnSecondary, sandboxInputClass } from './sandbox-styles'

interface SandboxFictitiousProductsProps {
  products: FulfillmentProduct[]
  shopifyProducts: ShopifyProduct[]
  onRefresh: () => Promise<void>
  onMessage: (text: string, error?: boolean) => void
}

type FictitiousProductForm = {
  country: string
  sku: string
  name: string
  price: string
  currency: string
}

const emptyForm: FictitiousProductForm = { country: '', sku: '', name: '', price: '', currency: 'EUR' }

export default function SandboxFictitiousProducts({
  products, shopifyProducts, onRefresh, onMessage,
}: SandboxFictitiousProductsProps) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FictitiousProductForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [countryFilter, setCountryFilter] = useState('')

  // Produtos com keep_local_copy já têm um espelho em fulfillment_products
  // mantido pelo sync — ficam fora deste CRUD manual para ninguém editar um
  // espelho pelo formulário errado.
  const mirroredProductIds = new Set(
    shopifyProducts.map((p) => p.local_product_id).filter((id): id is string => Boolean(id))
  )
  const fictitiousProducts = products.filter((p) => !mirroredProductIds.has(p.id))
  const filtered = countryFilter ? fictitiousProducts.filter((p) => p.country === countryFilter) : fictitiousProducts
  const countries = [...new Set(fictitiousProducts.map((p) => p.country))].sort()

  function closeForm() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  async function save() {
    setBusy('form')
    const res = await fetch('/api/fulfillment/products', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, id: editingId ?? undefined, price: Number(form.price) }),
    })
    const json = await getJson(res)
    onMessage(json.ok ? (editingId ? 'Produto atualizado.' : 'Produto salvo.') : (json.error ?? 'Erro ao salvar produto.'), !json.ok)
    if (json.ok) {
      closeForm()
      await onRefresh()
    }
    setBusy(null)
  }

  async function toggle(product: FulfillmentProduct) {
    setBusy(product.id)
    const res = product.active
      ? await fetch(`/api/fulfillment/products?id=${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, active: true }),
      })
    const json = await getJson(res)
    onMessage(json.ok ? (product.active ? 'Produto desativado.' : 'Produto reativado.') : (json.error ?? 'Erro.'), !json.ok)
    if (json.ok) await onRefresh()
    setBusy(null)
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold dark:text-[#e9edef]">Produtos fictícios ({fictitiousProducts.length})</p>
            <p className="text-xs text-[#667781]">Usados só nos pedidos simulados do sandbox.</p>
          </div>
          {countries.length > 1 && (
            <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className={`${sandboxInputClass} w-auto`} aria-label="Filtrar por país">
              <option value="">Todos</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button onClick={() => (showForm ? closeForm() : setShowForm(true))} className={sandboxBtnSecondary}>
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Fechar' : 'Novo'}
          </button>
        </div>

        {showForm && (
          <div className="mb-4 space-y-3 rounded-lg border border-[#f0f2f5] p-4 dark:border-[#2a3942]">
            <p className="text-xs font-semibold text-[#667781]">{editingId ? 'Editar produto fictício' : 'Novo produto fictício'}</p>
            <input className={sandboxInputClass} placeholder="País, ex: SPAIN" value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} />
            <input className={sandboxInputClass} placeholder="SKU" value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            <input className={sandboxInputClass} placeholder="Nome do produto" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <input className={sandboxInputClass} placeholder="Preço" type="number" min={0} step="0.01" value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
              <input className={sandboxInputClass} placeholder="EUR" value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={busy === 'form' || !form.country || !form.sku || !form.name || !form.price}
                className={sandboxBtnPrimary}
              >
                {busy === 'form' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingId ? 'Salvar' : 'Adicionar produto'}
              </button>
              <button onClick={closeForm} className={sandboxBtnSecondary}>Cancelar</button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-[#667781]">Nenhum produto fictício cadastrado.</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((product) => (
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
                    setEditingId(product.id)
                    setForm({
                      country: product.country,
                      sku: product.sku,
                      name: product.name,
                      price: String(product.price),
                      currency: product.currency,
                    })
                    setShowForm(true)
                  }}
                  className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                  title="Editar"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => toggle(product)}
                  disabled={busy === product.id}
                  className={`rounded-lg p-1.5 disabled:opacity-40 ${product.active ? 'text-red-500 hover:bg-red-50' : 'text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'}`}
                  title={product.active ? 'Desativar' : 'Reativar'}
                >
                  {busy === product.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : product.active ? <Trash2 size={13} /> : <RotateCcw size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

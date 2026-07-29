'use client'

import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import type { ShopifyProduct } from '@/types'
import {
  filterShopifyProducts,
  paginateShopifyProducts,
  type ShopifyProductCopyFilter,
  type ShopifyProductSourceFilter,
} from '@/lib/shopify-product-catalog'
import ShopifyProductsTable from './shopify-products-table'
import ShopifyProductForm, { type ShopifyProductFormValues } from './shopify-product-form'

interface ShopifyProductsPanelProps {
  products: ShopifyProduct[]
  busyId: string | null
  syncBusy: boolean
  onSync: () => Promise<void>
  onToggleKeepLocalCopy: (product: ShopifyProduct, enabled: boolean) => Promise<void>
  onSave: (values: ShopifyProductFormValues, editingId: string | null) => Promise<void>
  onDelete: (product: ShopifyProduct) => Promise<void>
}

const PAGE_SIZE = 40
const inputClass = 'rounded-lg border border-[#d1d7db] bg-white px-3 py-2 text-sm outline-none focus:border-[#00a884] dark:border-[#2a3942] dark:bg-[#111b21] dark:text-[#e9edef]'
const btnSecondary = 'flex items-center gap-2 rounded-lg border border-[#d1d7db] bg-white px-3 py-2 text-sm font-semibold text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-40 dark:border-[#2a3942] dark:bg-[#111b21] dark:text-[#e9edef] dark:hover:bg-[#1f2c34]'

export default function ShopifyProductsPanel({
  products,
  busyId,
  syncBusy,
  onSync,
  onToggleKeepLocalCopy,
  onSave,
  onDelete,
}: ShopifyProductsPanelProps) {
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<ShopifyProductSourceFilter>('all')
  const [copyFilter, setCopyFilter] = useState<ShopifyProductCopyFilter>('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<ShopifyProduct | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formBusy, setFormBusy] = useState(false)

  const filteredProducts = useMemo(
    () => filterShopifyProducts(products, {
      search,
      source: sourceFilter,
      copy: copyFilter,
    }),
    [copyFilter, products, search, sourceFilter],
  )
  const paginated = paginateShopifyProducts(filteredProducts, page, PAGE_SIZE)
  const firstVisible = filteredProducts.length === 0 ? 0 : (paginated.page - 1) * PAGE_SIZE + 1
  const lastVisible = Math.min(paginated.page * PAGE_SIZE, filteredProducts.length)
  const localCopyCount = products.filter((product) => product.keep_local_copy).length

  function updateSearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  function updateSourceFilter(value: ShopifyProductSourceFilter) {
    setSourceFilter(value)
    setPage(1)
  }

  function updateCopyFilter(value: ShopifyProductCopyFilter) {
    setCopyFilter(value)
    setPage(1)
  }

  async function handleSave(values: ShopifyProductFormValues) {
    setFormBusy(true)
    await onSave(values, editing?.id ?? null)
    setFormBusy(false)
    setShowForm(false)
    setEditing(null)
  }

  function openEditor(product: ShopifyProduct | null) {
    setEditing(product)
    setShowForm(true)
  }

  return (
    <section className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 border-b border-[#d1d7db] pb-5 sm:flex-row sm:flex-wrap sm:items-start dark:border-[#2a3942]">
        <div className="flex min-w-0 items-start gap-3 sm:flex-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e7f8f4] text-[#008f72] dark:bg-[#103b35] dark:text-[#53d6bd]">
            <Package size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#111b21] dark:text-[#e9edef]">Catálogo de produtos</h2>
            <p className="mt-0.5 text-sm text-[#667781]">
              {products.length} produtos, {localCopyCount} disponíveis para IA, fluxos e simulações
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onSync} disabled={syncBusy} className={btnSecondary}>
            {syncBusy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Sincronizar Shopify
          </button>
          <button
            onClick={() => showForm ? setShowForm(false) : openEditor(null)}
            className="flex items-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-sm font-semibold text-white hover:bg-[#008f72]"
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? 'Fechar formulário' : 'Adicionar produto'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-[#d1d7db] py-5 dark:border-[#2a3942]">
          <div className="max-w-2xl">
            <h3 className="mb-3 text-sm font-bold text-[#111b21] dark:text-[#e9edef]">
              {editing ? 'Editar produto' : 'Novo produto manual'}
            </h3>
            <ShopifyProductForm
              editing={editing}
              busy={formBusy}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditing(null) }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 py-4">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
          <input
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder="Buscar por produto, variante ou SKU"
            className={`${inputClass} w-full pl-9`}
          />
        </label>
        <select
          value={sourceFilter}
          onChange={(event) => updateSourceFilter(event.target.value as ShopifyProductSourceFilter)}
          className={inputClass}
          aria-label="Filtrar por origem"
        >
          <option value="all">Todas as origens</option>
          <option value="shopify">Shopify</option>
          <option value="manual">Manuais</option>
        </select>
        <select
          value={copyFilter}
          onChange={(event) => updateCopyFilter(event.target.value as ShopifyProductCopyFilter)}
          className={inputClass}
          aria-label="Filtrar por cópia local"
        >
          <option value="all">Todos os usos</option>
          <option value="local">Com cópia local</option>
          <option value="not-local">Sem cópia local</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#d1d7db] bg-white dark:border-[#2a3942] dark:bg-[#111b21]">
        <div className="border-b border-[#f0f2f5] px-4 py-2.5 text-xs text-[#667781] dark:border-[#2a3942]">
          {filteredProducts.length === products.length
            ? `${products.length} produtos`
            : `${filteredProducts.length} de ${products.length} produtos`}
        </div>
        <div className="p-3">
          <ShopifyProductsTable
            products={paginated.products}
            busyId={busyId}
            onToggleKeepLocalCopy={onToggleKeepLocalCopy}
            onEdit={openEditor}
            onDelete={onDelete}
          />
        </div>
        {filteredProducts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f2f5] px-4 py-3 dark:border-[#2a3942]">
            <span className="text-xs text-[#667781]">
              Exibindo {firstVisible}-{lastVisible} de {filteredProducts.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, paginated.page - 1))}
                disabled={paginated.page === 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-30 dark:border-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#1f2c34]"
                title="Página anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="min-w-20 text-center text-xs font-semibold text-[#54656f] dark:text-[#aebac1]">
                Página {paginated.page} de {paginated.totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(paginated.totalPages, paginated.page + 1))}
                disabled={paginated.page === paginated.totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-30 dark:border-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#1f2c34]"
                title="Próxima página"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

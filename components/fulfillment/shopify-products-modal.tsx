'use client'

import { useState } from 'react'
import { Loader2, Package, Plus, RefreshCw, X } from 'lucide-react'
import { ShopifyProduct } from '@/types'
import ShopifyProductsTable from './shopify-products-table'
import ShopifyProductForm, { ShopifyProductFormValues } from './shopify-product-form'

interface ShopifyProductsModalProps {
  products: ShopifyProduct[]
  busyId: string | null
  syncBusy: boolean
  onClose: () => void
  onSync: () => Promise<void>
  onToggleKeepLocalCopy: (product: ShopifyProduct, enabled: boolean) => Promise<void>
  onSave: (values: ShopifyProductFormValues, editingId: string | null) => Promise<void>
  onDelete: (product: ShopifyProduct) => Promise<void>
}

export default function ShopifyProductsModal({
  products, busyId, syncBusy, onClose, onSync, onToggleKeepLocalCopy, onSave, onDelete,
}: ShopifyProductsModalProps) {
  const [editing, setEditing] = useState<ShopifyProduct | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formBusy, setFormBusy] = useState(false)

  async function handleSave(values: ShopifyProductFormValues) {
    setFormBusy(true)
    await onSave(values, editing?.id ?? null)
    setFormBusy(false)
    setShowForm(false)
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl max-h-[85vh] flex-col rounded-2xl bg-white shadow-2xl dark:bg-[#111b21]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
          <Package size={17} className="text-[#00a884]" />
          <h2 className="flex-1 font-bold dark:text-[#e9edef]">Produtos reais (Shopify)</h2>
          <button
            onClick={onSync}
            disabled={syncBusy}
            className="flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]"
          >
            {syncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar agora
          </button>
          <button
            onClick={() => { setEditing(null); setShowForm((v) => !v) }}
            className="flex items-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-sm font-semibold text-white hover:bg-[#008f72]"
          >
            <Plus size={14} />Adicionar produto
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
            <X size={18} />
          </button>
        </div>

        {showForm && (
          <div className="border-b border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
            <ShopifyProductForm
              editing={editing}
              busy={formBusy}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditing(null) }}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <ShopifyProductsTable
            products={products}
            busyId={busyId}
            onToggleKeepLocalCopy={onToggleKeepLocalCopy}
            onEdit={(product) => { setEditing(product); setShowForm(true) }}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  )
}

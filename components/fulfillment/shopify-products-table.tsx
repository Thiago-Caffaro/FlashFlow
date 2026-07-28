'use client'

import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { ShopifyProduct } from '@/types'

interface ShopifyProductsTableProps {
  products: ShopifyProduct[]
  busyId: string | null
  onToggleKeepLocalCopy: (product: ShopifyProduct, enabled: boolean) => void
  onEdit: (product: ShopifyProduct) => void
  onDelete: (product: ShopifyProduct) => void
}

export default function ShopifyProductsTable({
  products, busyId, onToggleKeepLocalCopy, onEdit, onDelete,
}: ShopifyProductsTableProps) {
  if (products.length === 0) {
    return <p className="py-4 text-center text-sm text-[#667781]">Nenhum produto encontrado.</p>
  }

  return (
    <div className="space-y-1.5">
      {products.map((product) => (
        <div key={product.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#f0f2f5] px-3 py-2.5 dark:border-[#2a3942]">
          {product.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold dark:text-[#e9edef]">
              {product.title}{product.variant_title ? ` — ${product.variant_title}` : ''}
            </p>
            <p className="text-xs text-[#667781]">
              {product.sku || 'sem SKU'} · {product.source === 'shopify' ? 'shopify' : 'manual'}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-[#00a884]">
            {product.currency} {Number(product.price).toFixed(2)}
          </span>
          <label
            className="flex shrink-0 items-center gap-1.5 text-xs text-[#667781]"
            title="Manter uma cópia local sincronizada automaticamente (usada pela IA e pelo sandbox)"
          >
            <input
              type="checkbox"
              checked={product.keep_local_copy}
              onChange={(e) => onToggleKeepLocalCopy(product, e.target.checked)}
              disabled={busyId === product.id}
            />
            cópia local
          </label>
          <button
            onClick={() => onEdit(product)}
            className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
            title="Editar"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(product)}
            disabled={busyId === product.id}
            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
            title={product.source === 'manual' ? 'Excluir' : 'Ocultar (não afeta a loja Shopify real)'}
          >
            {busyId === product.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      ))}
    </div>
  )
}

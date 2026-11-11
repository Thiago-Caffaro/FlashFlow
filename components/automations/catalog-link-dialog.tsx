'use client'

import { useMemo, useState } from 'react'
import { Check, Search, Sparkles, X } from 'lucide-react'
import type { CatalogProductOption, LineProductWithLinks } from '@/types'
import { normalizeMatchText, suggestLineProduct } from '@/lib/product-line-match'

interface CatalogLinkDialogProps {
  product: LineProductWithLinks
  products: LineProductWithLinks[]
  catalog: CatalogProductOption[]
  onRun: (url: string, method: string, body?: unknown) => Promise<boolean>
  onClose: () => void
}

type Row = {
  item: CatalogProductOption
  key: string
  linkedHere: boolean
  linkedTo: LineProductWithLinks | null
  suggested: boolean
}

export default function CatalogLinkDialog({ product, products, catalog, onRun, onClose }: CatalogLinkDialogProps) {
  const [search, setSearch] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const productById = new Map(products.map((entry) => [entry.id, entry]))
    return catalog
      .map((item) => {
        const linkedTo = item.linked_line_product_id ? productById.get(item.linked_line_product_id) ?? null : null
        return {
          item,
          key: `${item.platform}:${item.integration_id}:${item.external_product_id}`,
          linkedHere: item.linked_line_product_id === product.id,
          linkedTo: linkedTo && linkedTo.id !== product.id ? linkedTo : null,
          suggested: suggestLineProduct(item.title, products)?.id === product.id,
        }
      })
      // Vinculados aqui, depois sugeridos, depois o resto — cada grupo por loja.
      .sort((a, b) =>
        Number(b.linkedHere) - Number(a.linkedHere) ||
        Number(b.suggested) - Number(a.suggested) ||
        a.item.store_label.localeCompare(b.item.store_label) ||
        a.item.title.localeCompare(b.item.title))
  }, [catalog, product.id, products])

  const visible = useMemo(() => {
    const query = normalizeMatchText(search)
    if (!query) return rows
    return rows.filter((row) => normalizeMatchText(`${row.item.title} ${row.item.store_label}`).includes(query))
  }, [rows, search])

  const pendingSuggestions = rows.filter((row) => row.suggested && !row.linkedHere && !row.linkedTo)

  function linkBody(item: CatalogProductOption) {
    return {
      line_product_id: product.id,
      platform: item.platform,
      integration_id: item.integration_id,
      external_product_id: item.external_product_id,
      title: item.title,
    }
  }

  async function toggle(row: Row) {
    if (row.linkedTo && !window.confirm(`"${row.item.title}" está vinculado a ${row.linkedTo.name}. Mover para ${product.name}?`)) return
    setBusyKey(row.key)
    try {
      if (row.linkedHere) {
        const link = product.links.find((entry) =>
          entry.platform === row.item.platform &&
          entry.integration_id === row.item.integration_id &&
          entry.external_product_id === row.item.external_product_id)
        if (link) await onRun(`/api/product-lines/links/${link.id}`, 'DELETE')
      } else {
        await onRun('/api/product-lines/links', 'POST', linkBody(row.item))
      }
    } finally {
      setBusyKey(null)
    }
  }

  async function linkAllSuggested() {
    setBusyKey('all')
    try {
      for (const row of pendingSuggestions) {
        if (!(await onRun('/api/product-lines/links', 'POST', linkBody(row.item)))) break
      }
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl dark:bg-[#111b21]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#e9edef] px-5 py-4 dark:border-[#2a3942]">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-[#111b21] dark:text-[#e9edef]">Vincular catálogo · {product.name}</h3>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">
              Marque os produtos de cada loja que são {product.name}. {product.links.length} vinculado(s).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33]">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f0f2f5] px-3 py-2 dark:bg-[#2a3942]">
            <Search size={16} className="text-[#667781]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título ou loja"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#111b21] outline-none dark:text-[#e9edef]"
            />
          </div>
          {pendingSuggestions.length > 0 && (
            <button
              type="button"
              onClick={() => void linkAllSuggested()}
              disabled={busyKey !== null}
              className="flex items-center gap-1.5 rounded-xl bg-[#00a884] px-3 py-2 text-xs font-medium text-white hover:bg-[#008f6f] disabled:opacity-50"
            >
              <Sparkles size={14} /> Vincular {pendingSuggestions.length} sugerido(s)
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {catalog.length === 0 && (
            <p className="py-6 text-center text-sm text-[#667781] dark:text-[#8696a0]">
              Nenhum produto no catálogo. Sincronize os produtos das lojas em Fulfillment primeiro.
            </p>
          )}
          {catalog.length > 0 && visible.length === 0 && (
            <p className="py-6 text-center text-sm text-[#667781] dark:text-[#8696a0]">Nada encontrado.</p>
          )}
          <div className="space-y-1.5">
            {visible.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => void toggle(row)}
                disabled={busyKey !== null}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                  row.linkedHere
                    ? 'border-[#00a884] bg-[#00a884]/5'
                    : 'border-[#e9edef] hover:bg-[#f5f6f6] dark:border-[#2a3942] dark:hover:bg-[#202c33]'
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  row.linkedHere ? 'border-[#00a884] bg-[#00a884] text-white' : 'border-[#d1d7db] dark:border-[#3d4f5a]'
                }`}>
                  {row.linkedHere && <Check size={14} />}
                </span>
                {row.item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.item.image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-lg bg-[#f0f2f5] dark:bg-[#202c33]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[#111b21] dark:text-[#e9edef]">{row.item.title}</span>
                  <span className="block truncate text-xs text-[#667781] dark:text-[#8696a0]">
                    {row.item.platform === 'shopify' ? 'Shopify' : 'Lightfunnels'} · {row.item.store_label}
                  </span>
                </span>
                {row.suggested && !row.linkedHere && (
                  <span className="shrink-0 rounded-full bg-[#00a884]/10 px-2 py-0.5 text-[10px] font-semibold text-[#00a884]">Sugerido</span>
                )}
                {row.linkedTo && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    Em {row.linkedTo.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

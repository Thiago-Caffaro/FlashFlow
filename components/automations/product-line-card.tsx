'use client'

import { useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import type { CatalogProductOption, LineProductWithLinks, ProductLineWithProducts } from '@/types'

interface ProductLineCardProps {
  line: ProductLineWithProducts
  catalog: CatalogProductOption[]
  onRun: (url: string, method: string, body?: unknown) => Promise<boolean>
  onLinkProduct: (product: LineProductWithLinks) => void
}

const inputClass =
  'rounded-xl border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2 text-sm text-[#111b21] outline-none transition-colors focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#e9edef]'

export default function ProductLineCard({ line, catalog, onRun, onLinkProduct }: ProductLineCardProps) {
  const [priority, setPriority] = useState(String(line.priority))
  const [newProduct, setNewProduct] = useState('')

  const storeLabel = (integrationId: string) =>
    catalog.find((item) => item.integration_id === integrationId)?.store_label ?? 'Loja'

  async function savePriority() {
    const value = Number(priority)
    if (!Number.isInteger(value) || value === line.priority) {
      setPriority(String(line.priority))
      return
    }
    if (!(await onRun(`/api/product-lines/${line.id}`, 'PUT', { priority: value }))) setPriority(String(line.priority))
  }

  async function addProduct() {
    const name = newProduct.trim()
    if (!name) return
    if (await onRun('/api/product-lines/products', 'POST', { name, product_line_id: line.id })) setNewProduct('')
  }

  async function deleteLine() {
    if (!window.confirm(`Apagar a linha ${line.code} com todos os produtos e vínculos?`)) return
    await onRun(`/api/product-lines/${line.id}`, 'DELETE')
  }

  async function deleteProduct(product: LineProductWithLinks) {
    if (!window.confirm(`Apagar o produto ${product.name} e seus vínculos?`)) return
    await onRun(`/api/product-lines/products/${product.id}`, 'DELETE')
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[#00a884]/10 px-3 py-1 text-sm font-bold tracking-wide text-[#00a884]">{line.code}</span>
        {line.name !== line.code && (
          <span className="text-sm text-[#111b21] dark:text-[#e9edef]">{line.name}</span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-[#667781] dark:text-[#8696a0]">
          Prioridade
          <input
            type="number"
            min={0}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            onBlur={() => void savePriority()}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            className={`${inputClass} w-20 py-1`}
          />
        </label>
        <button
          type="button"
          onClick={() => void deleteLine()}
          title="Apagar linha"
          className="rounded-lg p-2 text-[#667781] transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="space-y-2">
        {line.products.length === 0 && (
          <p className="text-sm text-[#667781] dark:text-[#8696a0]">Nenhum produto nesta linha.</p>
        )}
        {line.products.map((product) => (
          <div key={product.id} className="rounded-xl border border-[#e9edef] p-3 dark:border-[#2a3942]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{product.name}</span>
              <span className={`text-xs ${product.links.length === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                {product.links.length === 0
                  ? 'sem vínculo — carrinhos dele não são reconhecidos'
                  : `${product.links.length} item(ns) de catálogo vinculado(s)`}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onLinkProduct(product)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#00a884] transition-colors hover:bg-[#00a884]/10"
                >
                  <Link2 size={14} /> Vincular catálogo
                </button>
                <button
                  type="button"
                  onClick={() => void deleteProduct(product)}
                  title="Apagar produto"
                  className="rounded-lg p-1.5 text-[#667781] transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {product.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {product.links.map((link) => (
                  <span
                    key={link.id}
                    className="rounded-full bg-[#f0f2f5] px-2.5 py-1 text-[11px] text-[#54656f] dark:bg-[#202c33] dark:text-[#aebac1]"
                    title={link.title}
                  >
                    {storeLabel(link.integration_id)} · {link.title || link.external_product_id}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={newProduct}
          onChange={(event) => setNewProduct(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void addProduct() }}
          placeholder={`Novo produto em ${line.code}`}
          maxLength={80}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => void addProduct()}
          disabled={!newProduct.trim()}
          className="flex items-center gap-1 rounded-xl border border-[#00a884] px-3 py-2 text-sm font-medium text-[#00a884] transition-colors hover:bg-[#00a884]/10 disabled:opacity-50"
        >
          <Plus size={16} /> Produto
        </button>
      </div>
    </div>
  )
}

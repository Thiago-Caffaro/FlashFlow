'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CatalogProductOption, LineProductWithLinks, ProductLineWithProducts } from '@/types'
import ProductLineCard from './product-line-card'
import CatalogLinkDialog from './catalog-link-dialog'

type ApiResult = { ok?: boolean; error?: string }

async function productLinesRequest(url: string, method: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json().catch(() => ({})) as ApiResult
    return response.ok && json.ok ? { ok: true } : { ok: false, error: json.error ?? `Erro ${response.status}` }
  } catch {
    return { ok: false, error: 'Falha de conexão' }
  }
}

const inputClass =
  'rounded-xl border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2 text-sm text-[#111b21] outline-none transition-colors focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#e9edef]'

export default function ProductLinesPanel() {
  const [lines, setLines] = useState<ProductLineWithProducts[]>([])
  const [catalog, setCatalog] = useState<CatalogProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [linkingProduct, setLinkingProduct] = useState<LineProductWithLinks | null>(null)

  const load = useCallback(async () => {
    try {
      const [linesRes, catalogRes] = await Promise.all([
        fetch('/api/product-lines', { cache: 'no-store' }).then((res) => res.json()),
        fetch('/api/product-lines/catalog', { cache: 'no-store' }).then((res) => res.json()),
      ])
      if (linesRes.ok) setLines(linesRes.lines ?? [])
      else setError(linesRes.error ?? 'Não foi possível carregar as linhas')
      if (catalogRes.ok) setCatalog(catalogRes.products ?? [])
      else setError(catalogRes.error ?? 'Não foi possível carregar o catálogo')
    } catch {
      setError('Falha de conexão')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Toda alteração recarrega linhas e catálogo: o catálogo marca a qual
  // produto cada item está vinculado.
  const run = useCallback(async (url: string, method: string, body?: unknown) => {
    const result = await productLinesRequest(url, method, body)
    setError(result.ok ? null : result.error ?? 'Erro inesperado')
    if (result.ok) await load()
    return Boolean(result.ok)
  }, [load])

  async function addLine() {
    const code = newCode.trim()
    if (!code) return
    const nextPriority = lines.reduce((max, line) => Math.max(max, line.priority), 0) + 10
    if (await run('/api/product-lines', 'POST', { code, priority: nextPriority })) setNewCode('')
  }

  // Mantém o produto aberto no diálogo atualizado depois de cada recarga.
  const openProduct = linkingProduct
    ? lines.flatMap((line) => line.products).find((product) => product.id === linkingProduct.id) ?? null
    : null
  const allProducts = lines.flatMap((line) => line.products)

  if (loading) {
    return <p className="text-sm text-[#667781] dark:text-[#8696a0]">Carregando…</p>
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</div>
      )}

      <p className="text-sm text-[#667781] dark:text-[#8696a0]">
        Cada produto precisa ser vinculado aos itens do catálogo de cada loja (os IDs mudam de loja para loja). É por esse
        vínculo que o sistema descobre a linha de um carrinho. Com produtos de linhas diferentes, vale a linha de menor
        prioridade.
      </p>

      {lines.map((line) => (
        <ProductLineCard
          key={line.id}
          line={line}
          catalog={catalog}
          onRun={run}
          onLinkProduct={setLinkingProduct}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
        <input
          value={newCode}
          onChange={(event) => setNewCode(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void addLine() }}
          placeholder="Código da nova linha (ex: EMA)"
          maxLength={20}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => void addLine()}
          disabled={!newCode.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-[#00a884] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#008f6f] disabled:opacity-50"
        >
          <Plus size={16} /> Nova linha
        </button>
      </div>

      {openProduct && (
        <CatalogLinkDialog
          product={openProduct}
          products={allProducts}
          catalog={catalog}
          onRun={run}
          onClose={() => setLinkingProduct(null)}
        />
      )}
    </div>
  )
}

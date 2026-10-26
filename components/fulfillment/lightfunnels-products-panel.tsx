'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EyeOff, Loader2, Search } from 'lucide-react'
import { LightfunnelsProduct } from '@/types'

interface LightfunnelsProductsPanelProps {
  // Muda quando outro lugar sincroniza o catálogo, para recarregar a lista.
  refreshKey?: number
}

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

function formatPrice(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

// Catálogo Lightfunnels sincronizado. "Cópia local" mantém a variante
// espelhada em fulfillment_products (catálogo do FenixCOD e da IA); ocultar
// só esconde aqui — o Lightfunnels não é alterado.
export default function LightfunnelsProductsPanel({ refreshKey = 0 }: LightfunnelsProductsPanelProps) {
  const [products, setProducts] = useState<LightfunnelsProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const json = await fetch('/api/fulfillment/lightfunnels/products', { cache: 'no-store' }).then(getJson)
    if (json.ok) setProducts(json.products ?? [])
    else setError(json.error ?? 'Erro ao carregar produtos Lightfunnels.')
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  async function patch(body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey)
    setError(null)
    const json = await fetch('/api/fulfillment/lightfunnels/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(getJson)
    if (!json.ok) setError(json.error ?? 'Erro ao atualizar produto.')
    await load()
    setBusyId(null)
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return products
    return products.filter((product) => [product.title, product.variant_title, product.sku]
      .some((value) => String(value ?? '').toLowerCase().includes(term)))
  }, [products, query])

  if (loading) {
    return <div className="flex h-20 items-center justify-center"><Loader2 className="animate-spin text-[#00a884]" /></div>
  }
  if (products.length === 0 && !error) return null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold dark:text-[#e9edef]">Produtos Lightfunnels</h2>
          <p className="text-xs text-[#667781]">Sincronize pela integração em Configurações. SKU com sufixo <code>,N</code> indica pacote de N unidades.</p>
        </div>
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto ou SKU"
            className="w-64 rounded-lg border border-transparent bg-[#f0f2f5] py-2 pl-8 pr-3 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]"
          />
        </label>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20">{error}</p>}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[#f0f2f5] text-left text-xs font-semibold text-[#667781] dark:border-[#2a3942]">
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Pacote</th>
              <th className="px-4 py-3">Preço</th>
              <th className="px-4 py-3">Cópia local</th>
              <th className="px-4 py-3" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((product) => (
              <tr key={product.id} className="border-b border-[#f0f2f5] last:border-0 dark:border-[#2a3942]">
                <td className="px-4 py-3">
                  <span className="block font-semibold dark:text-[#e9edef]">{product.title}</span>
                  {product.variant_title && <span className="block text-xs text-[#667781]">{product.variant_title}</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs dark:text-[#e9edef]">
                  {product.sku || <span className="text-red-500">sem SKU</span>}
                </td>
                <td className="px-4 py-3 text-xs text-[#667781]">{product.units_per_pack > 1 ? `${product.units_per_pack} un.` : '—'}</td>
                <td className="px-4 py-3 text-xs dark:text-[#e9edef]">{formatPrice(Number(product.price), product.currency)}</td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="accent-[#00a884]"
                    checked={product.keep_local_copy}
                    disabled={busyId !== null}
                    onChange={(e) => void patch({ ids: [product.id], keep_local_copy: e.target.checked }, product.id)}
                    aria-label={`Cópia local de ${product.title}`}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => void patch({ id: product.id, hidden: true }, product.id)}
                    disabled={busyId !== null}
                    className="rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-40 dark:hover:bg-[#2a3942]"
                    title="Ocultar (não altera o Lightfunnels)"
                  >
                    {busyId === product.id ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

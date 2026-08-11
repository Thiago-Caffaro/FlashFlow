'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, Clock3, Loader2, RefreshCw } from 'lucide-react'
import type { ShopifyOrderTimelineEvent } from '@/lib/shopify-order-timeline'

async function getJson(response: Response) {
  return response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
}

export default function ShopifyOrderTimeline({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<ShopifyOrderTimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTimeline = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/fulfillment/orders/${orderId}/shopify-timeline`, { cache: 'no-store' })
      const body = await getJson(response)
      if (!response.ok || !body.ok) throw new Error(body.error || 'Falha ao consultar a Timeline Shopify')
      setEvents(Array.isArray(body.events) ? body.events : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao consultar a Timeline Shopify')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  return (
    <section className="px-6 py-4" aria-labelledby="shopify-timeline-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 id="shopify-timeline-title" className="text-xs font-semibold uppercase tracking-wide text-[#667781]">
            Timeline Shopify
          </h3>
          <p className="mt-1 text-xs text-[#667781]">Eventos mais recentes registrados no pedido.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTimeline()}
          disabled={loading}
          className="rounded-lg p-2 text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-40 dark:hover:bg-[#2a3942]"
          title="Atualizar Timeline"
          aria-label="Atualizar Timeline Shopify"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && events.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-sm text-[#667781]">
          <Loader2 size={15} className="animate-spin" /> Consultando a Shopify...
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && events.length === 0 && (
        <p className="py-3 text-sm text-[#667781]">Nenhum evento disponível para este pedido.</p>
      )}
      {events.length > 0 && (
        <ol className="relative ml-2 border-l border-[#dfe3e5] dark:border-[#334650]">
          {events.map((event) => (
            <li key={event.id} className="relative pb-5 pl-5 last:pb-0">
              <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-[#111b21] ${event.critical ? 'bg-red-500' : 'bg-[#00a884]'}`} />
              <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">{event.message}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#667781]">
                <span className="inline-flex items-center gap-1">
                  <Clock3 size={11} />
                  {new Date(event.createdAt).toLocaleString('pt-BR')}
                </span>
                {event.author && <span>{event.author}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

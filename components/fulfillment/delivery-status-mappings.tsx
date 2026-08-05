'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/types'
import type { DeliveryStatusMapping } from '@/lib/fulfillment-delivery-status'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function DeliveryStatusMappings() {
  const [mappings, setMappings] = useState<DeliveryStatusMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const json = await fetch('/api/fulfillment/delivery-status-mappings', { cache: 'no-store' }).then(getJson)
    if (json.ok) {
      setMappings(json.mappings ?? [])
      setError(null)
    } else {
      setError(json.error ?? 'Não foi possível carregar os mapeamentos.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function updateMapping(mapping: DeliveryStatusMapping, deliveryStatus: DeliveryStatus | null) {
    setBusyKey(mapping.external_status_key)
    const json = await fetch('/api/fulfillment/delivery-status-mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_status_key: mapping.external_status_key,
        delivery_status: deliveryStatus,
      }),
    }).then(getJson)
    if (json.ok) {
      setMappings((current) => current.map((item) => (
        item.external_status_key === mapping.external_status_key ? json.mapping : item
      )))
      setError(null)
    } else {
      setError(json.error ?? 'Não foi possível atualizar o mapeamento.')
    }
    setBusyKey(null)
  }

  const visibleMappings = [...mappings].sort((left, right) => {
    if (left.delivery_status === null && right.delivery_status !== null) return -1
    if (left.delivery_status !== null && right.delivery_status === null) return 1
    return left.external_label.localeCompare(right.external_label)
  })

  return (
    <div className="border-t border-[#f0f2f5] pt-5 dark:border-[#2a3942]">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold dark:text-[#e9edef]">Mapeamento de estados de entrega</h4>
        {mappings.some((mapping) => mapping.delivery_status === null) && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <AlertTriangle size={11} />
            {mappings.filter((mapping) => mapping.delivery_status === null).length} pendente(s)
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[#667781]">
        Estados desconhecidos não alteram pedidos até receberem um mapeamento interno.
      </p>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20">{error}</p>}
      {loading ? (
        <div className="flex h-20 items-center justify-center"><Loader2 size={18} className="animate-spin text-[#00a884]" /></div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[#e9edef] dark:border-[#2a3942]">
          {visibleMappings.map((mapping) => (
            <div
              key={mapping.external_status_key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_1.5rem] items-center gap-2 border-b border-[#f0f2f5] px-3 py-2 last:border-b-0 dark:border-[#2a3942]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium dark:text-[#e9edef]">{mapping.external_label}</p>
                <p className="text-xs text-[#667781]">Visto {mapping.seen_count} vez(es)</p>
              </div>
              <select
                value={mapping.delivery_status ?? ''}
                onChange={(event) => void updateMapping(
                  mapping,
                  event.target.value ? event.target.value as DeliveryStatus : null
                )}
                disabled={busyKey === mapping.external_status_key}
                className="rounded-lg border border-[#d1d7db] bg-white px-2 py-2 text-sm outline-none focus:border-[#00a884] disabled:opacity-60 dark:border-[#3d4f5a] dark:bg-[#182229] dark:text-[#e9edef]"
              >
                <option value="">Pendente</option>
                {DELIVERY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              {busyKey === mapping.external_status_key
                ? <Loader2 size={15} className="animate-spin text-[#00a884]" />
                : mapping.delivery_status ? <Check size={15} className="text-[#00a884]" /> : <AlertTriangle size={15} className="text-amber-500" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

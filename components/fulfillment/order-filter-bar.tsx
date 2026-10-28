'use client'

import { ArrowUpDown, Search, X } from 'lucide-react'
import {
  Account,
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  SEND_STATUSES,
  type CommercialStatus,
  type ConfirmationTriggerState,
  type DeliveryStatus,
  type OrderSource,
  type SendStatus,
} from '@/types'
import {
  ORDER_SORT_OPTIONS,
  countActiveFilters,
  type OrderFilters,
  type OrderSortKey,
} from '@/lib/fulfillment-order-filters'
import { ORDER_PLATFORM_LABELS } from '@/lib/order-platform'

interface OrderFilterBarProps {
  filters: OrderFilters
  onChange: (patch: Partial<OrderFilters>) => void
  onClear: () => void
  accounts: Account[]
  countries: string[]
  // A fila só lista "Não responde", então não faz sentido filtrar por status comercial/envio/entrega.
  showStatusFilters?: boolean
}

const fieldClass = 'rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const labelClass = 'flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#667781]'

const TRIGGER_LABELS: Record<ConfirmationTriggerState, string> = {
  pending: 'Gatilho pendente',
  sent: 'Gatilho disparado',
  failed: 'Falha no gatilho',
}

export default function OrderFilterBar({
  filters, onChange, onClear, accounts, countries, showStatusFilters = true,
}: OrderFilterBarProps) {
  const activeCount = countActiveFilters(filters)

  return (
    <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
          <input
            className={`${fieldClass} w-full pl-8`}
            placeholder="Pesquisar cliente, telefone, pedido..."
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </div>
        <label className={labelClass}>
          <span className="flex items-center gap-1"><ArrowUpDown size={11} />Ordenar por</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as OrderSortKey })}
            className={fieldClass}
          >
            {ORDER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {showStatusFilters && (
          <>
            <label className={labelClass}>
              Status
              <select
                value={filters.commercialStatus}
                onChange={(e) => onChange({ commercialStatus: e.target.value as '' | CommercialStatus })}
                className={fieldClass}
              >
                <option value="">Todos</option>
                {COMMERCIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Envio
              <select
                value={filters.sendStatus}
                onChange={(e) => onChange({ sendStatus: e.target.value as '' | SendStatus })}
                className={fieldClass}
              >
                <option value="">Todos</option>
                {SEND_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Entrega
              <select
                value={filters.deliveryStatus}
                onChange={(e) => onChange({ deliveryStatus: e.target.value as '' | DeliveryStatus })}
                className={fieldClass}
              >
                <option value="">Todas</option>
                {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </>
        )}
        <label className={labelClass}>
          Conta
          <select value={filters.instance} onChange={(e) => onChange({ instance: e.target.value })} className={fieldClass}>
            <option value="">Todas</option>
            {accounts.map((a) => <option key={a.instanceName} value={a.instanceName}>{a.label || a.instanceName}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Origem
          <select
            value={filters.source}
            onChange={(e) => onChange({ source: e.target.value as '' | OrderSource })}
            className={fieldClass}
          >
            <option value="">Todas</option>
            {(Object.keys(ORDER_PLATFORM_LABELS) as OrderSource[]).map((source) => (
              <option key={source} value={source}>{ORDER_PLATFORM_LABELS[source]}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          País
          <select value={filters.country} onChange={(e) => onChange({ country: e.target.value })} className={fieldClass}>
            <option value="">Todos</option>
            {countries.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Gatilho
          <select
            value={filters.triggerState}
            onChange={(e) => onChange({ triggerState: e.target.value as '' | ConfirmationTriggerState })}
            className={fieldClass}
          >
            <option value="">Todos</option>
            {(Object.keys(TRIGGER_LABELS) as ConfirmationTriggerState[]).map((state) => (
              <option key={state} value={state}>{TRIGGER_LABELS[state]}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Pedido de
          <input
            type="date"
            value={filters.dateFrom}
            max={filters.dateTo || undefined}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Pedido até
          <input
            type="date"
            value={filters.dateTo}
            min={filters.dateFrom || undefined}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className={fieldClass}
          />
        </label>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]"
          >
            <X size={14} />Limpar filtros ({activeCount})
          </button>
        )}
      </div>
    </div>
  )
}

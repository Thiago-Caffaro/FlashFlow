'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Account, AutomationWithSteps, ProductLineWithProducts } from '@/types'
import { countryLabel } from '@/lib/automation-display'
import { AUTOMATION_KIND_ORDER, AUTOMATION_PRESETS } from '@/lib/automation-presets'
import AutomationCard from './automation-card'
import AutomationDialog from './automation-dialog'

type ApiResult = { ok?: boolean; error?: string }

const selectClass =
  'rounded-xl border border-[#d1d7db] bg-white px-3 py-2 text-sm text-[#111b21] outline-none focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#202c33] dark:text-[#e9edef]'

// Lista de automações em cards, com filtro por país e por linha de produto.
export default function AutomationsPanel() {
  const [automations, setAutomations] = useState<AutomationWithSteps[]>([])
  const [lines, setLines] = useState<ProductLineWithProducts[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [lineFilter, setLineFilter] = useState('')
  // undefined = fechado; null = criar nova
  const [editing, setEditing] = useState<AutomationWithSteps | null | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const [automationsRes, linesRes, accountsRes] = await Promise.all([
        fetch('/api/automations', { cache: 'no-store' }).then((res) => res.json()),
        fetch('/api/product-lines', { cache: 'no-store' }).then((res) => res.json()),
        fetch('/api/accounts', { cache: 'no-store' }).then((res) => res.json()),
      ])
      if (automationsRes.ok) setAutomations(automationsRes.automations ?? [])
      else setError(automationsRes.error ?? 'Não foi possível carregar as automações')
      if (linesRes.ok) setLines(linesRes.lines ?? [])
      setAccounts(accountsRes.accounts ?? [])
    } catch {
      setError('Falha de conexão')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = useCallback(async (url: string, method: string, body?: unknown) => {
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json().catch(() => ({})) as ApiResult
      if (!response.ok || !json.ok) {
        setError(json.error ?? `Erro ${response.status}`)
        return false
      }
      setError(null)
      await load()
      return true
    } catch {
      setError('Falha de conexão')
      return false
    }
  }, [load])

  const countries = useMemo(
    () => [...new Set(automations.map((automation) => automation.country).filter((country): country is string => Boolean(country)))].sort(),
    [automations]
  )
  const visible = automations.filter((automation) =>
    (!kindFilter || automation.kind === kindFilter)
    && (!countryFilter || automation.country === countryFilter)
    && (!lineFilter || (lineFilter === 'any' ? automation.product_line_id === null : automation.product_line_id === lineFilter)))

  if (loading) {
    return <p className="text-sm text-[#667781] dark:text-[#8696a0]">Carregando…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className={selectClass} aria-label="Filtrar por modelo">
          <option value="">Todos os modelos</option>
          {AUTOMATION_KIND_ORDER.map((kind) => <option key={kind} value={kind}>{AUTOMATION_PRESETS[kind].label}</option>)}
        </select>
        <select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)} className={selectClass} aria-label="Filtrar por país">
          <option value="">Todos os países</option>
          {countries.map((country) => <option key={country} value={country}>{countryLabel(country)}</option>)}
        </select>
        <select value={lineFilter} onChange={(event) => setLineFilter(event.target.value)} className={selectClass} aria-label="Filtrar por linha">
          <option value="">Todas as linhas</option>
          <option value="any">Qualquer linha</option>
          {lines.map((line) => <option key={line.id} value={line.id}>{line.code}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="ml-auto flex items-center gap-2 rounded-xl bg-[#00a884] px-4 py-2 text-sm font-semibold text-white hover:bg-[#008069]"
        >
          <Plus size={16} /> Nova automação
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      {automations.length === 0 ? (
        <div className="rounded-2xl bg-white p-7 text-sm text-[#667781] shadow-sm dark:bg-[#111b21] dark:text-[#8696a0]">
          Nenhuma automação ainda. Escolha um modelo pronto (carrinho abandonado, pedido criado, status de entrega ou
          palavra-chave), o país, a linha de produto e o número, e ajuste a mensagem.
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[#667781] dark:text-[#8696a0]">Nenhuma automação com esses filtros.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              line={lines.find((line) => line.id === automation.product_line_id) ?? null}
              account={accounts.find((account) => account.instanceName === automation.instance_name) ?? null}
              onToggle={(enabled) => run(`/api/automations/${automation.id}`, 'PATCH', { enabled })}
              onEdit={() => setEditing(automation)}
              onDelete={() => run(`/api/automations/${automation.id}`, 'DELETE')}
            />
          ))}
        </div>
      )}

      {editing !== undefined && (
        <AutomationDialog
          automation={editing}
          lines={lines}
          accounts={accounts}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            void load()
          }}
        />
      )}
    </div>
  )
}

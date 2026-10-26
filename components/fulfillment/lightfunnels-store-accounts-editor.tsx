'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Account, LightfunnelsFunnel, LightfunnelsStoreAccountLink } from '@/types'

interface LightfunnelsStoreAccountsEditorProps {
  integrationId: string
  accounts: Account[]
}

type LinkDraft = { linked: boolean; priority: number; funnelIds: string[] }

const EMPTY_DRAFT: LinkDraft = { linked: false, priority: 100, funnelIds: [] }
const inputClass = 'w-20 rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2 text-sm outline-none focus:border-[#00a884] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef]'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

// Contas WhatsApp que atendem os pedidos de uma conta Lightfunnels. Cada
// vínculo pode receber todos os funis ou só os funis marcados — assim um
// funil de Portugal cai na conta PT e um da Espanha na conta ES, mesmo sendo
// a mesma conta Lightfunnels.
export default function LightfunnelsStoreAccountsEditor({ integrationId, accounts }: LightfunnelsStoreAccountsEditorProps) {
  const selectableAccounts = accounts.filter((account) => !account.isSandbox)
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({})
  const [funnels, setFunnels] = useState<LightfunnelsFunnel[]>([])
  const [funnelsError, setFunnelsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const applyLinks = useCallback((links: LightfunnelsStoreAccountLink[]) => {
    const next: Record<string, LinkDraft> = {}
    for (const link of links) {
      next[link.instance_name] = { linked: link.enabled, priority: link.priority, funnelIds: link.funnel_ids }
    }
    setDrafts(next)
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const base = `/api/fulfillment/lightfunnels/integrations/${encodeURIComponent(integrationId)}`
    setLoading(true)
    Promise.all([
      fetch(`${base}/accounts`, { cache: 'no-store' }).then(getJson),
      fetch(`${base}/funnels`, { cache: 'no-store' }).then(getJson),
    ])
      .then(([accountsJson, funnelsJson]) => {
        if (cancelled) return
        if (accountsJson.ok) applyLinks(accountsJson.accounts ?? [])
        else setMessage({ text: accountsJson.error ?? 'Erro ao carregar as contas vinculadas.', error: true })
        if (funnelsJson.ok) setFunnels(funnelsJson.funnels ?? [])
        else setFunnelsError(funnelsJson.error ?? 'Não foi possível listar os funis.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [integrationId, applyLinks])

  function update(instanceName: string, patch: Partial<LinkDraft>) {
    setDrafts((prev) => ({ ...prev, [instanceName]: { ...(prev[instanceName] ?? EMPTY_DRAFT), ...patch } }))
    setDirty(true)
    setMessage(null)
  }

  function toggleFunnel(instanceName: string, funnelId: string) {
    const current = drafts[instanceName]?.funnelIds ?? []
    update(instanceName, {
      funnelIds: current.includes(funnelId) ? current.filter((id) => id !== funnelId) : [...current, funnelId],
    })
  }

  async function save() {
    setSaving(true)
    const links = Object.entries(drafts)
      .filter(([, draft]) => draft.linked)
      .map(([instanceName, draft]) => ({
        instance_name: instanceName,
        priority: draft.priority,
        enabled: true,
        funnel_ids: draft.funnelIds,
      }))
    const json = await fetch(`/api/fulfillment/lightfunnels/integrations/${encodeURIComponent(integrationId)}/accounts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: links }),
    }).then(getJson)
    if (json.ok) {
      applyLinks(json.accounts ?? [])
      setMessage({ text: links.length > 0 ? 'Contas salvas.' : 'Sem contas vinculadas — vale a regra geral.' })
    } else {
      setMessage({ text: json.error ?? 'Erro ao salvar as contas.', error: true })
    }
    setSaving(false)
  }

  const funnelName = (id: string) => funnels.find((funnel) => funnel.id === id)?.name ?? id
  const linkedCount = Object.values(drafts).filter((draft) => draft.linked).length

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold dark:text-[#e9edef]">Contas WhatsApp desta conta Lightfunnels</p>
        <p className="mt-0.5 text-xs text-[#667781]">
          Pedidos vão para uma das contas marcadas. Contas dedicadas a funis recebem os pedidos desses funis primeiro; contas sem funil marcado
          recebem os demais. Em empate, vale o país do pedido e depois a menor prioridade. Sem nenhuma marcada, vale a regra geral.
        </p>
      </div>

      {loading ? (
        <div className="flex h-16 items-center justify-center"><Loader2 size={16} className="animate-spin text-[#00a884]" /></div>
      ) : selectableAccounts.length === 0 ? (
        <p className="text-sm text-[#667781]">Nenhuma conta WhatsApp cadastrada.</p>
      ) : (
        <div className="space-y-2">
          {selectableAccounts.map((account) => {
            const draft = drafts[account.instanceName] ?? EMPTY_DRAFT
            return (
              <div
                key={account.instanceName}
                className={`rounded-lg border p-3 transition-colors ${
                  draft.linked ? 'border-[#00a884] bg-[#e7f8f4]/50 dark:bg-[#00a884]/10' : 'border-[#f0f2f5] dark:border-[#2a3942]'
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.linked}
                    onChange={(e) => update(account.instanceName, { linked: e.target.checked })}
                    className="accent-[#00a884]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold dark:text-[#e9edef]">{account.label || account.instanceName}</span>
                    <span className="block text-xs text-[#667781]">
                      {account.country || 'sem país'}
                      {draft.linked && (draft.funnelIds.length > 0
                        ? ` · ${draft.funnelIds.length} funil(is): ${draft.funnelIds.map(funnelName).join(', ')}`
                        : ' · todos os funis')}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={draft.priority}
                    disabled={!draft.linked}
                    onChange={(e) => update(account.instanceName, { priority: Number(e.target.value) })}
                    className={inputClass}
                    title="Prioridade (menor = mais alta)"
                    aria-label={`Prioridade de ${account.label || account.instanceName}`}
                  />
                </label>

                {draft.linked && (
                  <div className="mt-3 border-t border-[#f0f2f5] pt-3 dark:border-[#2a3942]">
                    {funnelsError ? (
                      <p className="text-xs text-red-500">{funnelsError}</p>
                    ) : funnels.length === 0 ? (
                      <p className="text-xs text-[#667781]">Nenhum funil encontrado nesta conta Lightfunnels.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {funnels.map((funnel) => {
                          const selected = draft.funnelIds.includes(funnel.id)
                          return (
                            <button
                              key={funnel.id}
                              type="button"
                              onClick={() => toggleFunnel(account.instanceName, funnel.id)}
                              aria-pressed={selected}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                selected
                                  ? 'border-[#00a884] bg-[#00a884] text-white'
                                  : 'border-[#d1d7db] text-[#54656f] hover:border-[#00a884] dark:border-[#3d4f5a] dark:text-[#aebac1]'
                              }`}
                              title={funnel.published ? 'Funil publicado' : 'Funil não publicado'}
                            >
                              {funnel.name}{funnel.published ? '' : ' (rascunho)'}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-[#8696a0]">Nenhum funil marcado = recebe todos os funis.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving || loading || !dirty}
          className="flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar contas
        </button>
        <span className="text-xs text-[#667781]">{linkedCount} vinculada(s)</span>
        {message && (
          <span className={`text-xs ${message.error ? 'text-red-500' : 'text-[#008f72] dark:text-[#00a884]'}`}>{message.text}</span>
        )}
      </div>
    </div>
  )
}

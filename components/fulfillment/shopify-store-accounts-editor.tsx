'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Account, ShopifyStoreAccountLink } from '@/types'

interface ShopifyStoreAccountsEditorProps {
  integrationId: string
  accounts: Account[]
}

type LinkDraft = { linked: boolean; priority: number }

const inputClass = 'w-20 rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2 text-sm outline-none focus:border-[#00a884] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef]'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

// Contas WhatsApp que atendem os pedidos e carrinhos de uma loja Shopify.
export default function ShopifyStoreAccountsEditor({ integrationId, accounts }: ShopifyStoreAccountsEditorProps) {
  const selectableAccounts = accounts.filter((account) => !account.isSandbox)
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const applyLinks = useCallback((links: ShopifyStoreAccountLink[]) => {
    const next: Record<string, LinkDraft> = {}
    for (const link of links) next[link.instance_name] = { linked: link.enabled, priority: link.priority }
    setDrafts(next)
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/fulfillment/shopify/integrations/${encodeURIComponent(integrationId)}/accounts`, { cache: 'no-store' })
      .then(getJson)
      .then((json) => {
        if (cancelled) return
        if (json.ok) applyLinks(json.accounts ?? [])
        else setMessage({ text: json.error ?? 'Erro ao carregar as contas da loja.', error: true })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [integrationId, applyLinks])

  function update(instanceName: string, patch: Partial<LinkDraft>) {
    setDrafts((prev) => ({ ...prev, [instanceName]: { ...(prev[instanceName] ?? { linked: false, priority: 100 }), ...patch } }))
    setDirty(true)
    setMessage(null)
  }

  async function save() {
    setSaving(true)
    const links = Object.entries(drafts)
      .filter(([, draft]) => draft.linked)
      .map(([instanceName, draft]) => ({ instance_name: instanceName, priority: draft.priority, enabled: true }))
    const json = await fetch(`/api/fulfillment/shopify/integrations/${encodeURIComponent(integrationId)}/accounts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: links }),
    }).then(getJson)
    if (json.ok) {
      applyLinks(json.accounts ?? [])
      setMessage({ text: links.length > 0 ? 'Contas da loja salvas.' : 'Loja sem contas vinculadas — vale a regra geral.' })
    } else {
      setMessage({ text: json.error ?? 'Erro ao salvar as contas da loja.', error: true })
    }
    setSaving(false)
  }

  const linkedCount = Object.values(drafts).filter((draft) => draft.linked).length

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold dark:text-[#e9edef]">Contas WhatsApp desta loja</p>
        <p className="mt-0.5 text-xs text-[#667781]">
          Pedidos e carrinhos desta loja vão para uma das contas marcadas: primeiro a do país do pedido, depois a de menor prioridade.
          Sem nenhuma marcada, vale a regra geral abaixo.
        </p>
      </div>

      {loading ? (
        <div className="flex h-16 items-center justify-center"><Loader2 size={16} className="animate-spin text-[#00a884]" /></div>
      ) : selectableAccounts.length === 0 ? (
        <p className="text-sm text-[#667781]">Nenhuma conta WhatsApp cadastrada.</p>
      ) : (
        <div className="space-y-2">
          {selectableAccounts.map((account) => {
            const draft = drafts[account.instanceName] ?? { linked: false, priority: 100 }
            return (
              <label
                key={account.instanceName}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  draft.linked ? 'border-[#00a884] bg-[#e7f8f4]/50 dark:bg-[#00a884]/10' : 'border-[#f0f2f5] dark:border-[#2a3942]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={draft.linked}
                  onChange={(e) => update(account.instanceName, { linked: e.target.checked })}
                  className="accent-[#00a884]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold dark:text-[#e9edef]">{account.label || account.instanceName}</span>
                  <span className="block text-xs text-[#667781]">{account.country || 'sem país'}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.priority}
                  disabled={!draft.linked}
                  onChange={(e) => update(account.instanceName, { priority: Number(e.target.value) })}
                  className={inputClass}
                  title="Prioridade nesta loja (menor = mais alta)"
                  aria-label={`Prioridade de ${account.label || account.instanceName}`}
                />
              </label>
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
          Salvar contas da loja
        </button>
        <span className="text-xs text-[#667781]">{linkedCount} vinculada(s)</span>
        {message && (
          <span className={`text-xs ${message.error ? 'text-red-500' : 'text-[#008f72] dark:text-[#00a884]'}`}>{message.text}</span>
        )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'

interface WhatsAppMessageTemplate {
  id: string
  meta_template_name: string
  language: string
  category: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'
  body_text: string
  variable_count: number
  last_synced_at: string | null
}

interface Props {
  instanceName: string
}

const STATUS_STYLE: Record<WhatsAppMessageTemplate['status'], string> = {
  approved: 'bg-[#e7f8f4] text-[#008f72] dark:bg-[#0b141a] dark:text-[#00a884]',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  rejected: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
  paused: 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]',
  disabled: 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]',
}

const STATUS_LABEL: Record<WhatsAppMessageTemplate['status'], string> = {
  approved: 'Aprovado',
  pending: 'Pendente',
  rejected: 'Rejeitado',
  paused: 'Pausado',
  disabled: 'Desativado',
}

// Só renderiza algo para contas cloud_api — busca o provider da própria
// instância em vez de exigir uma prop nova em GeneralSettingsTab (mesmo
// padrão usado em message-editor-modal.tsx para essa mesma checagem).
export default function WhatsAppCloudTemplatesTab({ instanceName }: Props) {
  const [isCloudApiAccount, setIsCloudApiAccount] = useState<boolean | null>(null)
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/accounts')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        const accounts = Array.isArray(json.accounts) ? json.accounts : []
        const account = accounts.find((a: { instance_name?: string }) => a.instance_name === instanceName)
        setIsCloudApiAccount(account?.provider === 'cloud_api')
      })
      .catch(() => { if (!cancelled) setIsCloudApiAccount(false) })
    return () => { cancelled = true }
  }, [instanceName])

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/whatsapp-cloud/templates?instance=${encodeURIComponent(instanceName)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar templates')
      setTemplates(json.templates ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar templates')
    } finally {
      setLoading(false)
    }
  }, [instanceName])

  useEffect(() => {
    if (isCloudApiAccount) void fetchTemplates()
  }, [isCloudApiAccount, fetchTemplates])

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/whatsapp-cloud/templates/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceName }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao sincronizar templates')
      await fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao sincronizar templates')
    } finally {
      setSyncing(false)
    }
  }

  if (isCloudApiAccount !== true) return null

  return (
    <div className="bg-white dark:bg-[#111b21] rounded-2xl p-7 space-y-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-[#00a884] shrink-0" />
          <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Templates da WhatsApp Cloud API</h3>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 text-sm font-semibold text-[#00a884] hover:bg-[#e7f8f3] dark:hover:bg-[#103c35] rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sincronizar
        </button>
      </div>
      <p className="text-sm text-[#aebac1] dark:text-[#667781]">
        Somente leitura — a criação e edição de templates continua no Gerenciador do WhatsApp da Meta. Sincronize aqui depois de aprovar um template novo para usá-lo nos fluxos.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-[#aebac1]" />
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-[#aebac1] dark:text-[#667781]">Nenhum template sincronizado ainda.</p>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div key={template.id} className="border border-[#e4e7e9] dark:border-[#2a3942] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{template.meta_template_name}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[template.status]}`}>
                  {STATUS_LABEL[template.status]}
                </span>
              </div>
              <p className="text-xs text-[#8696a0]">
                {template.language}{template.category ? ` · ${template.category}` : ''}
                {template.variable_count > 0 ? ` · ${template.variable_count} variável(is)` : ''}
              </p>
              <p className="text-sm text-[#3b4a54] dark:text-[#d1d7db] whitespace-pre-wrap">{template.body_text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

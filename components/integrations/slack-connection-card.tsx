'use client'

import { useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { SlackConnectionStatus } from '@/types'

interface SlackConnectionCardProps {
  status: SlackConnectionStatus | null
  loading: boolean
  onStatusChange: (status: SlackConnectionStatus) => void
}

const inputClass = 'w-full rounded-xl border border-transparent bg-[#f0f2f5] px-4 py-3 text-sm text-[#111b21] outline-none transition-colors placeholder:text-[#aebac1] focus:border-[#611f69] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#667781] dark:focus:border-[#c084fc]'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]'

// Manifesto do app (https://docs.slack.dev/reference/app-manifest): cria o
// app já com os escopos e a Request URL de interatividade corretos.
function buildManifest(interactivityUrl: string | null): string {
  return JSON.stringify({
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: {
      name: 'FlashFlow',
      description: 'Avisos de atendimento humano do FlashFlow (WhatsApp)',
    },
    features: { bot_user: { display_name: 'FlashFlow', always_online: true } },
    oauth_config: { scopes: { bot: ['chat:write', 'chat:write.public', 'channels:read', 'groups:read'] } },
    settings: {
      interactivity: { is_enabled: true, request_url: interactivityUrl ?? 'https://SEU-DOMINIO/api/webhook/slack/interactivity' },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }, null, 2)
}

export default function SlackConnectionCard({ status, loading, onStatusChange }: SlackConnectionCardProps) {
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState<'manifest' | 'url' | null>(null)

  const connected = Boolean(status?.connected)
  const showForm = !connected || editing

  async function copy(text: string, what: 'manifest' | 'url') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Não foi possível copiar — selecione e copie manualmente')
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/slack', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: botToken.trim() || undefined, signingSecret: signingSecret.trim() || undefined }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao salvar')
      onStatusChange(json.status)
      setBotToken('')
      setSigningSecret('')
      setEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar o Slack? Os nodes Slack dos fluxos passam a criar só a notificação interna.')) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/slack', { method: 'DELETE' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao desconectar')
      onStatusChange(json.status)
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Falha ao desconectar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 rounded-2xl bg-white p-7 shadow-sm dark:bg-[#111b21]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Conexão com o workspace</h3>
        {loading ? (
          <Loader2 size={16} className="animate-spin text-[#8696a0]" />
        ) : connected ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#e7f8f4] px-2.5 py-1 text-xs font-semibold text-[#008f72] dark:bg-[#0d2e27] dark:text-[#00a884]">
            <CheckCircle2 size={12} /> Conectado
          </span>
        ) : (
          <span className="rounded-full bg-[#f0f2f5] px-2.5 py-1 text-xs font-semibold text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]">
            Não conectado
          </span>
        )}
      </div>

      {connected && status && (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className={labelClass}>Workspace</dt>
            <dd className="text-[#111b21] dark:text-[#e9edef]">{status.teamName}</dd>
          </div>
          <div>
            <dt className={labelClass}>Bot</dt>
            <dd className="text-[#111b21] dark:text-[#e9edef]">@{status.botName}</dd>
          </div>
        </dl>
      )}

      {status?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">{status.error}</p>
      )}

      {status && !status.hasSigningSecret && connected && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Falta o Signing Secret — sem ele o botão &quot;Assumir atendimento&quot; não funciona.
        </p>
      )}

      <div>
        <p className={labelClass}>Request URL de interatividade</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-[#f0f2f5] px-3 py-2 text-xs text-[#111b21] dark:bg-[#2a3942] dark:text-[#e9edef]">
            {status?.interactivityUrl ?? 'Defina APP_BASE_URL (URL pública do app) para gerar este endereço'}
          </code>
          {status?.interactivityUrl && (
            <button
              type="button"
              onClick={() => void copy(status.interactivityUrl ?? '', 'url')}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs text-[#667781] hover:bg-[#f0f2f5] dark:text-[#8696a0] dark:hover:bg-[#2a3942]"
            >
              <Copy size={13} /> {copied === 'url' ? 'Copiado' : 'Copiar'}
            </button>
          )}
        </div>
      </div>

      {!connected && (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[#3b4a54] dark:text-[#aebac1]">
          <li>
            Em{' '}
            <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-[#611f69] underline dark:text-[#c084fc]">
              api.slack.com/apps <ExternalLink size={11} />
            </a>
            , clique em <strong>Create New App → From a manifest</strong>, escolha o workspace e cole o manifesto abaixo.
          </li>
          <li>Em <strong>Install App</strong>, instale no workspace e copie o <strong>Bot User OAuth Token</strong> (começa com xoxb-).</li>
          <li>Em <strong>Basic Information → App Credentials</strong>, copie o <strong>Signing Secret</strong>.</li>
          <li>Cole os dois abaixo e salve. Para canais privados, convide o bot no Slack com <code>/invite @FlashFlow</code>.</li>
        </ol>
      )}

      {!connected && (
        <button
          type="button"
          onClick={() => void copy(buildManifest(status?.interactivityUrl ?? null), 'manifest')}
          className="flex items-center gap-1.5 rounded-xl border border-[#d1d7db] px-3 py-2 text-sm font-medium text-[#111b21] hover:bg-[#f0f2f5] dark:border-[#3d4f5a] dark:text-[#e9edef] dark:hover:bg-[#2a3942]"
        >
          <Copy size={14} /> {copied === 'manifest' ? 'Manifesto copiado' : 'Copiar manifesto do app'}
        </button>
      )}

      {showForm && (
        <div className="space-y-4">
          <div>
            <label htmlFor="slack-bot-token" className={labelClass}>Bot User OAuth Token</label>
            <input
              id="slack-bot-token"
              type="password"
              autoComplete="off"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder={connected ? 'Deixe vazio para manter o atual' : 'xoxb-...'}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="slack-signing-secret" className={labelClass}>Signing Secret</label>
            <input
              id="slack-signing-secret"
              type="password"
              autoComplete="off"
              value={signingSecret}
              onChange={(event) => setSigningSecret(event.target.value)}
              placeholder={status?.hasSigningSecret ? 'Deixe vazio para manter o atual' : 'Basic Information → App Credentials'}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {showForm ? (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || (!botToken.trim() && !signingSecret.trim())}
              className="flex items-center gap-2 rounded-xl bg-[#611f69] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#4a154b] disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {connected ? 'Salvar credenciais' : 'Conectar'}
            </button>
            {connected && (
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-[#667781] hover:underline">Cancelar</button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-xl border border-[#d1d7db] px-4 py-2 text-sm font-medium text-[#111b21] hover:bg-[#f0f2f5] dark:border-[#3d4f5a] dark:text-[#e9edef] dark:hover:bg-[#2a3942]"
            >
              Atualizar credenciais
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
            >
              <Unplug size={14} /> Desconectar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

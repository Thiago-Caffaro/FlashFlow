'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, KeyRound, Link2, Loader2, Plug, PowerOff, RefreshCw, Save, Webhook, Zap } from 'lucide-react'
import { Account, LightfunnelsIntegration } from '@/types'
import LightfunnelsStoreAccountsEditor from '@/components/fulfillment/lightfunnels-store-accounts-editor'

interface LightfunnelsConfigProps {
  accounts: Account[]
  // Países com integração FenixCOD — o país padrão de cada conta LF sai daqui.
  fulfillmentCountries: string[]
  onOrdersChanged: () => Promise<void> | void
}

type Message = { text: string; error?: boolean } | null

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

function formatDateTime(value: string | null): string {
  if (!value) return 'nunca'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

// Integração Lightfunnels: app de Partners (um só), contas conectadas via
// OAuth, vínculos com contas WhatsApp (com filtro de funil), pausa global
// dos gatilhos e write-back opt-in.
export default function LightfunnelsConfig({ accounts, fulfillmentCountries, onOrdersChanged }: LightfunnelsConfigProps) {
  const [integrations, setIntegrations] = useState<LightfunnelsIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [creds, setCreds] = useState({ clientId: '', clientSecret: '', scopes: '', redirectUri: '', clientSecretSet: false })
  const [showCreds, setShowCreds] = useState(false)

  const [triggersEnabled, setTriggersEnabled] = useState(true)
  const [connectForm, setConnectForm] = useState({ name: '', country: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', default_country: '' })

  const showMsg = (text: string, error = false) => setMessage({ text, error })

  const load = useCallback(async () => {
    const [integrationsJson, settingsJson, triggersJson] = await Promise.all([
      fetch('/api/fulfillment/lightfunnels/integrations', { cache: 'no-store' }).then(getJson),
      fetch('/api/settings/lightfunnels', { cache: 'no-store' }).then(getJson),
      fetch('/api/settings/lightfunnels-triggers', { cache: 'no-store' }).then(getJson),
    ])
    if (integrationsJson.ok) setIntegrations(integrationsJson.integrations ?? [])
    if (settingsJson.ok) {
      setCreds({
        clientId: settingsJson.clientId ?? '',
        clientSecret: '',
        scopes: settingsJson.scopes ?? '',
        redirectUri: settingsJson.redirectUri ?? '',
        clientSecretSet: settingsJson.clientSecretSet === true,
      })
    }
    if (triggersJson.ok) setTriggersEnabled(triggersJson.enabled !== false)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // Resultado do OAuth chega como query string no redirect do callback.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('lightfunnelsError')
    const warning = params.get('lightfunnelsWebhookWarning')
    if (error) setMessage({ text: `Lightfunnels: ${error}`, error: true })
    else if (params.get('lightfunnelsConnected')) {
      setMessage(warning
        ? { text: `Conta Lightfunnels conectada, mas os webhooks falharam: ${warning}`, error: true }
        : { text: 'Conta Lightfunnels conectada e webhooks registrados.' })
    }
    if (error || params.get('lightfunnelsConnected')) {
      ;['lightfunnelsError', 'lightfunnelsWebhookWarning', 'lightfunnelsConnected'].forEach((key) => params.delete(key))
      const query = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    }
  }, [])

  useEffect(() => {
    if (!connectForm.country && fulfillmentCountries.length > 0) {
      setConnectForm((form) => ({ ...form, country: fulfillmentCountries[0] }))
    }
  }, [fulfillmentCountries, connectForm.country])

  async function saveCreds() {
    setBusy('creds')
    const json = await fetch('/api/settings/lightfunnels', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret, scopes: creds.scopes }),
    }).then(getJson)
    if (json.ok) {
      showMsg('Credenciais do app Lightfunnels salvas.')
      setShowCreds(false)
      await load()
    } else showMsg(json.error ?? 'Erro ao salvar credenciais.', true)
    setBusy(null)
  }

  async function toggleTriggers() {
    setBusy('triggers')
    const json = await fetch('/api/settings/lightfunnels-triggers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !triggersEnabled }),
    }).then(getJson)
    if (json.ok) setTriggersEnabled(json.enabled !== false)
    else showMsg(json.error ?? 'Erro ao alterar os gatilhos Lightfunnels.', true)
    setBusy(null)
  }

  async function connect() {
    setBusy('connect')
    const json = await fetch('/api/lightfunnels/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectForm),
    }).then(getJson)
    if (json.ok && typeof json.authUrl === 'string') {
      window.location.href = json.authUrl
      return
    }
    showMsg(json.error ?? 'Erro ao iniciar a conexão.', true)
    setBusy(null)
  }

  async function patchIntegration(id: string, patch: Record<string, unknown>, success: string) {
    setBusy(`patch-${id}`)
    const json = await fetch('/api/fulfillment/lightfunnels/integrations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).then(getJson)
    if (json.ok) {
      showMsg(success)
      await load()
    } else showMsg(json.error ?? 'Erro ao salvar.', true)
    setBusy(null)
  }

  async function deactivate(integration: LightfunnelsIntegration) {
    if (!window.confirm(`Desativar "${integration.name}"? Pedidos já importados continuam no FlashFlow.`)) return
    setBusy(`patch-${integration.id}`)
    const json = await fetch(`/api/fulfillment/lightfunnels/integrations?id=${encodeURIComponent(integration.id)}`, { method: 'DELETE' }).then(getJson)
    if (json.ok) {
      showMsg('Integração desativada.')
      await load()
    } else showMsg(json.error ?? 'Erro ao desativar.', true)
    setBusy(null)
  }

  async function sync(integration: LightfunnelsIntegration) {
    setBusy(`sync-${integration.id}`)
    const json = await fetch(`/api/fulfillment/lightfunnels/integrations/${encodeURIComponent(integration.id)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then(getJson)
    if (json.ok) {
      showMsg(`Sincronizado: ${json.orders ?? 0} pedido(s) e ${json.products ?? 0} variante(s) de produto.`)
      await onOrdersChanged()
    } else showMsg(json.error ?? 'Erro ao sincronizar.', true)
    setBusy(null)
  }

  async function ensureWebhooks(integration: LightfunnelsIntegration) {
    setBusy(`webhooks-${integration.id}`)
    const json = await fetch('/api/fulfillment/lightfunnels/webhooks/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrationId: integration.id, force: true }),
    }).then(getJson)
    const result = Array.isArray(json.results) ? json.results[0] : null
    if (json.ok) showMsg(`Webhooks registrados de novo (${result?.created ?? 0}).`)
    else showMsg(result?.error ?? json.error ?? 'Erro ao registrar webhooks.', true)
    setBusy(null)
  }

  function toggleExpanded(integration: LightfunnelsIntegration) {
    if (expandedId === integration.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(integration.id)
    setEditForm({ name: integration.name, default_country: integration.default_country })
  }

  const countryOptions = [...new Set([...fulfillmentCountries, ...integrations.map((i) => i.default_country)])].filter(Boolean)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold dark:text-[#e9edef]">Lightfunnels</h2>
          <p className="text-xs text-[#667781]">Pedidos confirmados nos funis entram na fila de confirmação, como os da Shopify.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={triggersEnabled}
          onClick={() => void toggleTriggers()}
          disabled={busy === 'triggers' || loading}
          className={`flex min-h-10 items-center gap-3 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
            triggersEnabled
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-[#d1d7db] bg-[#f0f2f5] text-[#54656f] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#aebac1]'
          }`}
          title="Ativa ou pausa os fluxos disparados por novos pedidos Lightfunnels"
        >
          {busy === 'triggers' ? <Loader2 size={17} className="animate-spin" /> : <Zap size={17} />}
          <span>Gatilhos Lightfunnels</span>
          <span className="text-xs">{triggersEnabled ? 'Ativos' : 'Pausados'}</span>
        </button>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

      {/* Credenciais do app */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <button
          onClick={() => setShowCreds((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#0b141a]"
        >
          <KeyRound size={18} className="shrink-0 text-[#00a884]" />
          <div className="flex-1">
            <p className="text-sm font-bold dark:text-[#e9edef]">Credenciais do App Lightfunnels</p>
            <p className="text-xs text-[#667781]">
              {loading ? 'Carregando…' : creds.clientId ? `Client ID: ${creds.clientId.slice(0, 8)}…` : 'Não configurado — clique para preencher'}
            </p>
          </div>
          {showCreds ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
        </button>
        {showCreds && (
          <div className="space-y-4 border-t border-[#f0f2f5] px-5 py-4 dark:border-[#2a3942]">
            <p className="text-xs text-[#667781]">
              Crie um app em <b>partners.lightfunnels.com</b> e copie Client ID e Client Secret da aba <b>Configurations</b>.
              Cadastre esta Redirect URI no app:{' '}
              <code className="break-all rounded bg-[#f0f2f5] px-1 py-0.5 dark:bg-[#2a3942]">{creds.redirectUri || 'defina APP_BASE_URL'}</code>
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Client ID</label>
                <input
                  className={inputClass}
                  name="lightfunnels-client-id"
                  autoComplete="off"
                  value={creds.clientId}
                  onChange={(e) => setCreds((c) => ({ ...c, clientId: e.target.value.trim() }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Client Secret</label>
                <input
                  className={inputClass}
                  type="password"
                  name="lightfunnels-client-secret"
                  autoComplete="new-password"
                  placeholder={creds.clientSecretSet ? 'Deixe vazio para manter o atual' : ''}
                  value={creds.clientSecret}
                  onChange={(e) => setCreds((c) => ({ ...c, clientSecret: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Scopes</label>
                <input
                  className={inputClass}
                  value={creds.scopes}
                  onChange={(e) => setCreds((c) => ({ ...c, scopes: e.target.value.trim() }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreds(false)} className={btnSecondary}>Cancelar</button>
              <button onClick={() => void saveCreds()} disabled={busy === 'creds'} className={btnPrimary}>
                {busy === 'creds' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar credenciais
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Conectar conta */}
      <div className="rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <p className="text-sm font-bold dark:text-[#e9edef]">Conectar conta Lightfunnels</p>
        <p className="mt-0.5 text-xs text-[#667781]">Você será levado ao Lightfunnels para autorizar o acesso a pedidos, produtos e funis.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#667781]">Nome (opcional)</label>
            <input
              className={inputClass}
              placeholder="Ex: Funis Europa"
              value={connectForm.name}
              onChange={(e) => setConnectForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#667781]">País padrão</label>
            <select
              className={inputClass}
              value={connectForm.country}
              onChange={(e) => setConnectForm((f) => ({ ...f, country: e.target.value }))}
            >
              {countryOptions.length === 0 && <option value="">Cadastre um país no FenixCOD</option>}
              {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
            </select>
          </div>
          <button
            onClick={() => void connect()}
            disabled={busy === 'connect' || !connectForm.country || !creds.clientId}
            className={btnPrimary}
          >
            {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            Conectar
          </button>
        </div>
      </div>

      {/* Contas conectadas */}
      {loading ? (
        <div className="flex h-20 items-center justify-center"><Loader2 className="animate-spin text-[#00a884]" /></div>
      ) : integrations.length === 0 ? (
        <p className="text-sm text-[#667781]">Nenhuma conta Lightfunnels conectada.</p>
      ) : (
        <div className="space-y-3">
          {integrations.map((integration) => {
            const expanded = expandedId === integration.id
            const statusText = !integration.active
              ? 'Desativada'
              : !integration.oauth_connected
                ? 'Desconectada — reconecte'
                : `Último webhook: ${formatDateTime(integration.last_webhook_at)}`
            return (
              <div key={integration.id} className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Link2 size={18} className={integration.active && integration.oauth_connected ? 'text-[#00a884]' : 'text-[#8696a0]'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold dark:text-[#e9edef]">{integration.name}</p>
                    <p className="text-xs text-[#667781]">
                      {integration.default_country} · {statusText}
                      {integration.writeback_enabled ? ' · write-back ligado' : ''}
                    </p>
                    {integration.last_error && <p className="text-xs text-red-500">{integration.last_error}</p>}
                  </div>
                  {integration.active && (
                    <>
                      <button onClick={() => void sync(integration)} disabled={busy !== null} className={btnSecondary} title="Importa pedidos recentes e o catálogo (sem disparar gatilhos)">
                        {busy === `sync-${integration.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Sincronizar
                      </button>
                      <button onClick={() => void ensureWebhooks(integration)} disabled={busy !== null} className={btnSecondary} title="Recria os webhooks no Lightfunnels">
                        {busy === `webhooks-${integration.id}` ? <Loader2 size={14} className="animate-spin" /> : <Webhook size={14} />}
                        Webhooks
                      </button>
                      <button onClick={() => void deactivate(integration)} disabled={busy !== null} className={btnSecondary} title="Desativar">
                        <PowerOff size={14} />
                      </button>
                    </>
                  )}
                  <button onClick={() => toggleExpanded(integration)} className={btnSecondary} aria-expanded={expanded}>
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Configurar
                  </button>
                </div>

                {expanded && (
                  <div className="space-y-6 border-t border-[#f0f2f5] px-5 py-5 dark:border-[#2a3942]">
                    <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#667781]">Nome</label>
                        <input className={inputClass} value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#667781]">País padrão</label>
                        <select
                          className={inputClass}
                          value={editForm.default_country}
                          onChange={(e) => setEditForm((f) => ({ ...f, default_country: e.target.value }))}
                        >
                          {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => void patchIntegration(integration.id, editForm, 'Integração salva.')}
                        disabled={busy !== null || !editForm.name.trim()}
                        className={btnPrimary}
                      >
                        <Save size={14} /> Salvar
                      </button>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#f0f2f5] p-3 dark:border-[#2a3942]">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[#00a884]"
                        checked={integration.writeback_enabled}
                        disabled={busy !== null}
                        onChange={(e) => void patchIntegration(
                          integration.id,
                          { writeback_enabled: e.target.checked },
                          e.target.checked ? 'Write-back ligado.' : 'Write-back desligado.',
                        )}
                      />
                      <span>
                        <span className="block text-sm font-semibold dark:text-[#e9edef]">Escrever status de volta no Lightfunnels</span>
                        <span className="block text-xs text-[#667781]">
                          Adiciona tags <code>ff:confirmado</code>, <code>ff:desistiu</code>, <code>ff:enviado-fenixcod</code> e de entrega
                          (<code>ff:entregue</code>…) aos pedidos. Tags do lojista são preservadas. Desligado por padrão.
                        </span>
                      </span>
                    </label>

                    <LightfunnelsStoreAccountsEditor integrationId={integration.id} accounts={accounts} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

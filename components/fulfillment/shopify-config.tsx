'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle, ExternalLink, KeyRound, Loader2, Pencil, RefreshCw,
  RotateCcw, Save, ShoppingBag, Trash2, Webhook,
} from 'lucide-react'
import { Account, ShopifyIntegration } from '@/types'
import ShopifyStoreAccountsEditor from '@/components/fulfillment/shopify-store-accounts-editor'

type ShopifyIntegrationForm = {
  shop_domain: string
  default_country: string
  active: boolean
  confirmation_message_template: string
  recovery_message_template: string
  recovery_template_id: string
  recovery_template_variable_map: Record<string, string>
}

interface CloudApiTemplateOption {
  id: string
  meta_template_name: string
  language: string
  variable_count: number
  instanceLabel: string
}

type AppCredentials = {
  clientId: string
  clientSecret: string
  scopes: string
  appBaseUrl: string
}

const emptyForm: ShopifyIntegrationForm = {
  shop_domain: '', default_country: '', active: true,
  confirmation_message_template: '', recovery_message_template: '',
  recovery_template_id: '', recovery_template_variable_map: {},
}

interface ShopifyConfigProps {
  shopifyIntegrations: ShopifyIntegration[]
  accounts: Account[]
  syncBusy: boolean
  onSync: () => Promise<void>
  onRefresh: () => Promise<void>
}

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'
const btnDanger = 'flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40 dark:bg-red-900/20 dark:hover:bg-red-900/30'

function statusClass(active: boolean) {
  return active
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
}

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

const VAR_HINT_CLASSES = 'inline-block rounded bg-[#f0f2f5] px-1 py-0.5 font-mono text-xs dark:bg-[#2a3942]'

export default function ShopifyConfig({
  shopifyIntegrations, accounts, syncBusy, onSync, onRefresh,
}: ShopifyConfigProps) {
  const [form, setForm] = useState<ShopifyIntegrationForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [activeStep, setActiveStep] = useState(1)

  const [creds, setCreds] = useState<AppCredentials>({ clientId: '', clientSecret: '', scopes: '', appBaseUrl: '' })
  const [credsLoaded, setCredsLoaded] = useState(false)
  const [showCredsForm, setShowCredsForm] = useState(false)
  const [credsBusy, setCredsBusy] = useState(false)

  const [appMode, setAppMode] = useState<'global' | 'own'>('global')
  const [storeApp, setStoreApp] = useState({ clientId: '', clientSecret: '' })

  const [webhookBusy, setWebhookBusy] = useState(false)
  const [webhookResult, setWebhookResult] = useState<{ text: string; error?: boolean } | null>(null)

  const [cloudApiTemplates, setCloudApiTemplates] = useState<CloudApiTemplateOption[]>([])
  const [cloudApiTemplatesLoading, setCloudApiTemplatesLoading] = useState(false)

  // Templates só existem pra contas cloud_api — o carrinho abandonado pode
  // cair em qualquer conta atribuída por país, então agrega os templates
  // aprovados de todas as contas cloud_api em vez de amarrar a uma só.
  useEffect(() => {
    const cloudAccounts = accounts.filter((a) => a.provider === 'cloud_api')
    if (cloudAccounts.length === 0) {
      setCloudApiTemplates([])
      return
    }
    let cancelled = false
    setCloudApiTemplatesLoading(true)
    Promise.all(cloudAccounts.map((account) =>
      fetch(`/api/whatsapp-cloud/templates?instance=${encodeURIComponent(account.instanceName)}`)
        .then(getJson)
        .then((json) => {
          if (!json.ok) return []
          const templates = Array.isArray(json.templates) ? json.templates : []
          return templates
            .filter((t: { status?: string }) => t.status === 'approved')
            .map((t: { id: string; meta_template_name: string; language: string; variable_count: number }) => ({
              id: t.id,
              meta_template_name: t.meta_template_name,
              language: t.language,
              variable_count: t.variable_count,
              instanceLabel: account.label,
            }))
        })
        .catch(() => [] as CloudApiTemplateOption[])
    )).then((lists) => {
      if (!cancelled) setCloudApiTemplates(lists.flat())
    }).finally(() => {
      if (!cancelled) setCloudApiTemplatesLoading(false)
    })
    return () => { cancelled = true }
  }, [accounts])

  const selectedRecoveryTemplate = cloudApiTemplates.find((t) => t.id === form.recovery_template_id) ?? null

  useEffect(() => {
    fetch('/api/settings/shopify').then(getJson).then((json) => {
      if (json.ok) {
        setCreds({
          clientId: json.clientId ?? '',
          clientSecret: '',
          scopes: json.scopes ?? '',
          appBaseUrl: json.appBaseUrl ?? '',
        })
        setCredsLoaded(true)
        if (!json.clientId) setShowCredsForm(true)
      }
    })
  }, [])

  async function saveAppCreds() {
    setCredsBusy(true)
    const res = await fetch('/api/settings/shopify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    })
    const json = await getJson(res)
    if (json.ok) {
      showMsg('Credenciais salvas.')
      setShowCredsForm(false)
      setCreds((c) => ({ ...c, clientSecret: '' }))
    } else {
      showMsg(json.error ?? 'Erro ao salvar credenciais.', true)
    }
    setCredsBusy(false)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('shopifyConnected')) {
      setMessage({ text: 'Loja conectada com sucesso via Shopify OAuth!' })
      setTimeout(() => setMessage(null), 6000)
      window.history.replaceState({}, '', window.location.pathname)
      onRefresh()
    }
    const err = params.get('shopifyError')
    if (err) {
      setMessage({ text: decodeURIComponent(err), error: true })
      window.history.replaceState({}, '', window.location.pathname)
    }
    const webhookWarning = params.get('shopifyWebhookWarning')
    if (webhookWarning) {
      setWebhookResult({ text: `Loja conectada, mas o webhook de pedidos não pôde ser registrado automaticamente: ${decodeURIComponent(webhookWarning)}`, error: true })
      window.history.replaceState({}, '', window.location.pathname)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showMsg(text: string, error = false) {
    setMessage({ text, error })
    setTimeout(() => setMessage(null), 5000)
  }

  async function ensureWebhooks() {
    setWebhookBusy(true)
    setWebhookResult(null)
    const json = await fetch('/api/fulfillment/shopify/webhooks/ensure', { method: 'POST' }).then(getJson)
    if (!json.ok && !json.results) {
      setWebhookResult({ text: json.error ?? 'Erro ao verificar webhooks.', error: true })
    } else {
      const results = (json.results ?? []) as Array<{ shopDomain: string; ok: boolean; alreadyRegistered: boolean; error?: string }>
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        setWebhookResult({ text: `Falha em ${failed.length} loja(s): ${failed.map((r) => `${r.shopDomain} (${r.error})`).join('; ')}`, error: true })
      } else {
        const registered = results.filter((r) => !r.alreadyRegistered).length
        setWebhookResult({
          text: registered > 0
            ? `Webhook de pedidos registrado em ${registered} loja(s). Já estava ativo nas demais.`
            : 'Webhook de pedidos já estava ativo em todas as lojas conectadas.',
        })
      }
    }
    setWebhookBusy(false)
  }

  function startEdit(integration: ShopifyIntegration) {
    setEditingId(integration.id)
    setForm({
      shop_domain: integration.shop_domain,
      default_country: integration.default_country,
      active: integration.active,
      confirmation_message_template: integration.confirmation_message_template ?? '',
      recovery_message_template: integration.recovery_message_template ?? '',
      recovery_template_id: integration.recovery_template_id ?? '',
      recovery_template_variable_map: integration.recovery_template_variable_map ?? {},
    })
    setShowForm(true)
    setActiveStep(1)
    setAppMode('global')
    setStoreApp({ clientId: '', clientSecret: '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelForm() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
    setActiveStep(1)
    setAppMode('global')
    setStoreApp({ clientId: '', clientSecret: '' })
  }

  // Inicia o OAuth por POST: o Client Secret do app próprio não pode ir em URL.
  async function startOAuth() {
    if (!form.shop_domain || !form.default_country) {
      showMsg('Preencha o domínio e o país padrão antes de conectar.', true)
      return
    }
    if (appMode === 'own' && (!storeApp.clientId || !storeApp.clientSecret)) {
      showMsg('Preencha o Client ID e o Client Secret do app da loja.', true)
      return
    }
    setBusy('oauth')
    const json = await fetch('/api/shopify/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: form.shop_domain,
        country: form.default_country,
        ...(appMode === 'own' ? storeApp : {}),
      }),
    }).then(getJson)
    if (json.ok && typeof json.authUrl === 'string') {
      window.location.href = json.authUrl
      return
    }
    showMsg(json.error ?? 'Não foi possível iniciar a conexão com o Shopify.', true)
    setBusy(null)
  }

  async function save() {
    if (!editingId) return
    setBusy('save')
    const res = await fetch('/api/fulfillment/shopify/integrations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, ...form }),
    })
    const json = await getJson(res)
    if (json.ok) {
      showMsg('Loja atualizada.')
      cancelForm()
      await onRefresh()
    } else {
      showMsg(json.error ?? 'Erro ao salvar loja.', true)
    }
    setBusy(null)
  }

  async function toggle(integration: ShopifyIntegration) {
    setBusy(integration.id)
    const res = integration.active
      ? await fetch(`/api/fulfillment/shopify/integrations?id=${encodeURIComponent(integration.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/shopify/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: integration.id, active: true }),
      })
    const json = await getJson(res)
    showMsg(
      json.ok ? (integration.active ? 'Loja desativada.' : 'Loja reativada.') : (json.error ?? 'Erro.'),
      !json.ok,
    )
    if (json.ok) await onRefresh()
    setBusy(null)
  }

  async function updateRouting(account: Account, patch: { confirmationEnabled?: boolean; confirmationPriority?: number }) {
    setBusy(`routing-${account.instanceName}`)
    const res = await fetch(`/api/accounts/${encodeURIComponent(account.instanceName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = await getJson(res)
    if (!json.ok) showMsg(json.error ?? 'Erro ao salvar roteamento.', true)
    if (json.ok) await onRefresh()
    setBusy(null)
  }

  const steps = [
    { n: 1, label: 'Conexão' },
    { n: 2, label: 'Sincronização' },
    { n: 3, label: 'Mensagens' },
    { n: 4, label: 'WhatsApp' },
  ]

  const canSave = Boolean(editingId && form.shop_domain && form.default_country)
  const editingIntegration = shopifyIntegrations.find((integration) => integration.id === editingId) ?? null
  const callbackUrl = `${(creds.appBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '')}/api/shopify/callback`

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

      {webhookResult && (
        <div className={`rounded-lg px-4 py-3 text-sm ${webhookResult.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {webhookResult.text}
        </div>
      )}

      {/* App credentials card */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <button
          onClick={() => setShowCredsForm((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#0b141a]"
        >
          <KeyRound size={18} className="shrink-0 text-[#00a884]" />
          <div className="flex-1">
            <p className="text-sm font-bold dark:text-[#e9edef]">Credenciais do App Shopify</p>
            <p className="text-xs text-[#667781]">
              {credsLoaded
                ? creds.clientId ? `Client ID: ${creds.clientId.slice(0, 8)}…` : 'Não configurado — clique para preencher'
                : 'Carregando…'}
            </p>
          </div>
          <span className="text-xs text-[#667781]">{showCredsForm ? '▲' : '▼'}</span>
        </button>

        {showCredsForm && (
          <div className="space-y-4 border-t border-[#f0f2f5] px-5 py-4 dark:border-[#2a3942]">
            <p className="text-xs text-[#667781]">
              Encontre em{' '}
              <b>Partners Dashboard → seu app → Settings → Client credentials</b>.
              O Client Secret só precisa ser preenchido ao alterar — deixe vazio para manter o atual.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Client ID</label>
                <input
                  className={inputClass}
                  name="shopify-client-id"
                  autoComplete="off"
                  placeholder="abc123..."
                  value={creds.clientId}
                  onChange={(e) => setCreds((c) => ({ ...c, clientId: e.target.value.trim() }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Client Secret</label>
                <input
                  className={inputClass}
                  type="password"
                  name="shopify-client-secret"
                  autoComplete="new-password"
                  placeholder="Deixe vazio para manter o atual"
                  value={creds.clientSecret}
                  onChange={(e) => setCreds((c) => ({ ...c, clientSecret: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">URL do App</label>
                <input
                  className={inputClass}
                  placeholder="https://flashflow.tail826755.ts.net"
                  value={creds.appBaseUrl}
                  onChange={(e) => setCreds((c) => ({ ...c, appBaseUrl: e.target.value.trim() }))}
                />
                <p className="mt-1 text-xs text-[#667781]">URL pública do FlashFlow (usada no callback OAuth).</p>
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
              <button onClick={() => setShowCredsForm(false)} className={btnSecondary}>Cancelar</button>
              <button onClick={saveAppCreds} disabled={credsBusy} className={btnPrimary}>
                {credsBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar credenciais
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section header */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <ShoppingBag size={22} className="text-[#00a884]" />
        <div className="flex-1">
          <h2 className="font-bold dark:text-[#e9edef]">Shopify</h2>
          <p className="text-xs text-[#667781]">Conecte suas lojas para importar pedidos e disparar confirmações por WhatsApp.</p>
        </div>
        <button onClick={onSync} disabled={syncBusy || shopifyIntegrations.length === 0} className={btnSecondary}>
          {syncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sincronizar
        </button>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={btnPrimary}>
            + Conectar loja
          </button>
        )}
      </div>

      {/* Setup form */}
      {showForm && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
          <div className="border-b border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
            <h3 className="font-bold dark:text-[#e9edef]">{editingId ? 'Editar loja' : 'Conectar nova loja'}</h3>
            <p className="mt-0.5 text-xs text-[#667781]">{editingId ? 'Edite mensagens, contas WhatsApp da loja ou reconecte.' : 'Autentique via OAuth para conectar sua loja Shopify.'}</p>
          </div>

          {/* Step tabs */}
          <div className="flex border-b border-[#f0f2f5] dark:border-[#2a3942]">
            {steps.map((step) => (
              <button
                key={step.n}
                onClick={() => setActiveStep(step.n)}
                className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                  activeStep === step.n
                    ? 'border-b-2 border-[#00a884] text-[#00a884]'
                    : 'text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef]'
                }`}
              >
                {step.n}. {step.label}
              </button>
            ))}
          </div>

          <div className="space-y-4 px-6 py-5">
            {activeStep === 1 && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Domínio Shopify</label>
                  <input
                    className={inputClass}
                    placeholder="minha-loja.myshopify.com"
                    value={form.shop_domain}
                    readOnly={!!editingId}
                    onChange={(e) => setForm((f) => ({ ...f, shop_domain: e.target.value.toLowerCase().trim() }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Encontre em Admin Shopify → Configurações → Informações da Loja</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">País padrão</label>
                  <input
                    className={inputClass}
                    placeholder="SPAIN"
                    value={form.default_country}
                    onChange={(e) => setForm((f) => ({ ...f, default_country: e.target.value.toUpperCase() }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Deve corresponder ao país configurado nas credenciais FenixCOD.</p>
                </div>
                <div className="space-y-3 rounded-lg border border-[#d1d7db] bg-[#f8f9fa] p-4 dark:border-[#2a3942] dark:bg-[#0b141a]">
                  <p className="text-sm font-semibold dark:text-[#e9edef]">App Shopify desta loja</p>
                  {editingIntegration && (
                    <p className="text-xs text-[#667781]">
                      Em uso: {editingIntegration.app_client_id
                        ? <>app próprio da loja (Client ID <code className={VAR_HINT_CLASSES}>{editingIntegration.app_client_id.slice(0, 8)}…</code>)</>
                        : 'app global (Credenciais do App Shopify)'}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['global', editingIntegration?.app_client_id ? 'Manter o app atual' : 'App global'],
                      ['own', editingIntegration ? 'Trocar por um app próprio' : 'App próprio da loja'],
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAppMode(mode)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${appMode === mode ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {appMode === 'own' ? (
                    <div className="space-y-3">
                      <p className="text-xs text-[#667781]">
                        Use quando a loja é de outra organização Shopify (um app de distribuição personalizada só instala em uma loja).
                        Crie o app em <b>dev.shopify.com</b> e, nas configurações dele, adicione esta URL de redirecionamento:
                      </p>
                      <code className="block break-all rounded bg-[#f0f2f5] px-2 py-1.5 font-mono text-xs dark:bg-[#2a3942] dark:text-[#e9edef]">{callbackUrl}</code>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="shopify-store-client-id" className="mb-1 block text-xs font-semibold text-[#667781]">Client ID do app da loja</label>
                          <input
                            id="shopify-store-client-id"
                            className={inputClass}
                            value={storeApp.clientId}
                            autoComplete="off"
                            onChange={(e) => setStoreApp((a) => ({ ...a, clientId: e.target.value.trim() }))}
                          />
                        </div>
                        <div>
                          <label htmlFor="shopify-store-client-secret" className="mb-1 block text-xs font-semibold text-[#667781]">Client Secret do app da loja</label>
                          <input
                            id="shopify-store-client-secret"
                            type="password"
                            className={inputClass}
                            value={storeApp.clientSecret}
                            autoComplete="off"
                            onChange={(e) => setStoreApp((a) => ({ ...a, clientSecret: e.target.value.trim() }))}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-[#667781]">O Client Secret é guardado cifrado e só é salvo depois que a autorização no Shopify der certo.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-[#667781]">
                      {editingIntegration?.app_client_id
                        ? 'Reconecta usando o mesmo app próprio já salvo para esta loja.'
                        : 'Usa as Credenciais do App Shopify configuradas acima, compartilhadas entre as lojas que usam o app global.'}
                    </p>
                  )}
                  <p className="text-xs text-[#667781]">
                    {editingId
                      ? 'Reconectar renova o token de acesso e os webhooks; as mensagens e contas desta loja são mantidas.'
                      : 'Você será redirecionado para o Shopify para autorizar o acesso. O token é guardado automaticamente.'}
                  </p>
                  <button
                    onClick={() => void startOAuth()}
                    disabled={busy === 'oauth'}
                    className={`${btnPrimary} w-full justify-center`}
                  >
                    {busy === 'oauth' ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                    {editingId ? 'Reconectar com Shopify' : 'Conectar com Shopify'}
                  </button>
                </div>
              </>
            )}

            {activeStep === 2 && (
              <>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/40 dark:bg-emerald-900/20">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">Verificação de webhook automática</p>
                  <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                    A assinatura HMAC de cada webhook recebido é verificada automaticamente usando a chave do app — nenhuma configuração manual de segredo é necessária.
                  </p>
                </div>
                <div className="rounded-lg border border-[#f0f2f5] bg-[#f8f9fa] p-4 text-sm dark:border-[#2a3942] dark:bg-[#182229]">
                  <p className="font-semibold dark:text-[#e9edef]">Recebimento em tempo real de pedidos</p>
                  <p className="mt-1 text-[#667781]">
                    Ao conectar uma loja, o FlashFlow registra sozinho os webhooks de pedidos (criado, atualizado, pago, cancelado e excluído) em
                    {' '}<code className="rounded bg-[#f0f2f5] px-1 dark:bg-[#2a3942]">/api/webhook/shopify/orders</code> e de checkout (criado e atualizado) em
                    {' '}<code className="rounded bg-[#f0f2f5] px-1 dark:bg-[#2a3942]">/api/webhook/shopify/abandoned-checkouts</code>, para que pedidos e carrinhos apareçam em tempo real — sem precisar clicar em Sincronizar.
                    Não crie webhooks à mão no admin da Shopify: eles são assinados com outra chave e são rejeitados.
                    Use o botão abaixo para verificar/registrar de novo a qualquer momento (ex: em lojas conectadas antes desse recurso existir, ou depois de trocar a URL do app).
                  </p>
                  <button onClick={ensureWebhooks} disabled={webhookBusy} className={`${btnSecondary} mt-3`}>
                    {webhookBusy ? <Loader2 size={14} className="animate-spin" /> : <Webhook size={14} />}
                    Verificar webhook de pedidos
                  </button>
                </div>
                <p className="text-xs text-[#667781]">
                  O botão <strong>Sincronizar</strong> continua disponível para reimportar pedidos e carrinhos antigos, ou como reforço caso um webhook seja perdido.
                </p>
              </>
            )}

            {activeStep === 3 && (
              <>
                <div className="rounded-lg border border-[#f0f2f5] bg-[#f8f9fa] p-3 dark:border-[#2a3942] dark:bg-[#182229]">
                  <p className="text-xs text-[#667781]">
                    A mensagem de confirmação de pedido agora é configurada em <strong>Gatilhos</strong>, criando um gatilho do tipo <strong>&quot;Pedido Shopify criado&quot;</strong> apontando para um fluxo. Sem esse gatilho configurado, nenhuma mensagem automática é enviada.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Mensagem de recuperação de carrinho</label>
                  <p className="mb-2 text-xs text-[#667781]">
                    Variáveis:
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{nome}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{total}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{currency}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{link}}'}</span>
                  </p>
                  <textarea
                    className={`${inputClass} resize-y`}
                    rows={4}
                    placeholder={'Olá{{nome}}!\nSeu carrinho de {{currency}} {{total}} ainda está disponível.{{link}}\nResponda se precisar de ajuda.'}
                    value={form.recovery_message_template}
                    onChange={(e) => setForm((f) => ({ ...f, recovery_message_template: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Deixe em branco para usar o modelo padrão.</p>
                </div>

                <div className="rounded-lg border border-[#f0f2f5] bg-[#f8f9fa] p-4 dark:border-[#2a3942] dark:bg-[#182229]">
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">
                    Template para contas API oficial (opcional)
                  </label>
                  <p className="mb-2 text-xs text-[#667781]">
                    Carrinho abandonado é sempre uma mensagem iniciada pela empresa — numa conta cloud_api fora da janela de 24h de atendimento, a mensagem acima (texto livre) é rejeitada pela Meta. Configure um template aprovado aqui para esses casos; sem ele, o envio falha com um erro claro em vez de tentar e ser recusado.
                  </p>
                  {cloudApiTemplatesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#667781]">
                      <Loader2 size={13} className="animate-spin" /> Carregando templates...
                    </div>
                  ) : cloudApiTemplates.length === 0 ? (
                    <p className="text-xs text-[#8696a0]">
                      Nenhum template aprovado sincronizado ainda (ou nenhuma conta API oficial configurada). Sincronize em Configurações Gerais da conta.
                    </p>
                  ) : (
                    <>
                      <select
                        className={inputClass}
                        value={form.recovery_template_id}
                        onChange={(e) => setForm((f) => ({ ...f, recovery_template_id: e.target.value, recovery_template_variable_map: {} }))}
                      >
                        <option value="">Nenhum — só usar texto livre</option>
                        {cloudApiTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.meta_template_name} ({t.language}) — {t.instanceLabel}
                          </option>
                        ))}
                      </select>
                      {selectedRecoveryTemplate && selectedRecoveryTemplate.variable_count > 0 && (
                        <div className="mt-3 flex flex-col gap-2">
                          <span className="text-xs font-semibold text-[#667781]">Variáveis do template</span>
                          {Array.from({ length: selectedRecoveryTemplate.variable_count }, (_, i) => String(i + 1)).map((key) => (
                            <label key={key} className="flex flex-col gap-1">
                              <span className="text-xs text-[#8696a0]">{`{{${key}}}`}</span>
                              <input
                                className={inputClass}
                                placeholder="Texto literal ou {{contato.primeiro_nome}}"
                                value={form.recovery_template_variable_map[key] ?? ''}
                                onChange={(e) => setForm((f) => ({
                                  ...f,
                                  recovery_template_variable_map: { ...f.recovery_template_variable_map, [key]: e.target.value },
                                }))}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {activeStep === 4 && (
              <>
                {editingId ? (
                  <ShopifyStoreAccountsEditor integrationId={editingId} accounts={accounts} />
                ) : (
                  <p className="rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm text-[#667781] dark:bg-[#2a3942]">
                    Conecte a loja primeiro; depois, em Editar, escolha as contas WhatsApp dela.
                  </p>
                )}
                <div className="border-t border-[#f0f2f5] pt-4 dark:border-[#2a3942]">
                  <p className="text-sm font-semibold dark:text-[#e9edef]">Regra geral</p>
                  <p className="mt-0.5 text-xs text-[#667781]">
                    Vale para lojas sem conta vinculada: a conta padrão dos novos pedidos (topo da página) ou, sem ela, a conta ativa do país do pedido com a menor prioridade.
                    Estas opções valem para todas as lojas.
                  </p>
                </div>
                {accounts.length === 0 && (
                  <p className="text-sm text-[#667781]">Nenhuma conta WhatsApp cadastrada.</p>
                )}
                {accounts.map((account) => (
                  <div key={account.instanceName} className="flex items-center gap-3 rounded-lg border border-[#f0f2f5] p-3 dark:border-[#2a3942]">
                    <div className="flex-1">
                      <p className="text-sm font-semibold dark:text-[#e9edef]">{account.label || account.instanceName}</p>
                      <p className="text-xs text-[#667781]">{account.country || 'sem país'}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-[#667781]">
                      <input
                        type="checkbox"
                        checked={account.confirmationEnabled ?? true}
                        disabled={busy === `routing-${account.instanceName}`}
                        onChange={(e) => updateRouting(account, { confirmationEnabled: e.target.checked })}
                      />
                      Ativa
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={account.confirmationPriority ?? 100}
                      disabled={busy === `routing-${account.instanceName}`}
                      onChange={(e) => updateRouting(account, { confirmationPriority: Number(e.target.value) })}
                      className={`${inputClass} w-20`}
                      title="Prioridade (menor = mais alta)"
                    />
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[#f0f2f5] px-6 py-4 dark:border-[#2a3942]">
            <div className="flex gap-2">
              {activeStep > 1 && (
                <button onClick={() => setActiveStep(activeStep - 1)} className={btnSecondary}>← Anterior</button>
              )}
              {activeStep < 4 && (
                <button onClick={() => setActiveStep(activeStep + 1)} className={btnPrimary}>Próximo →</button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={cancelForm} className={btnSecondary}>Cancelar</button>
              {editingId && (
                <button onClick={save} disabled={busy === 'save' || !canSave} className={btnPrimary}>
                  {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Salvar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Integrations list */}
      {shopifyIntegrations.length > 0 ? (
        <div className="space-y-2">
          {shopifyIntegrations.map((integration) => (
            <div key={integration.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-sm dark:bg-[#111b21]">
              <CheckCircle size={18} className={integration.active ? 'text-[#00a884]' : 'text-[#aebac1]'} />
              <div className="min-w-52 flex-1">
                <b className="dark:text-[#e9edef]">{integration.shop_name}</b>
                <p className="text-xs text-[#667781]">{integration.shop_domain} · {integration.default_country}</p>
              </div>
              {integration.oauth_connected && (
                <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">OAuth</span>
              )}
              {integration.app_client_id && (
                <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" title="Conectada com o app próprio da loja">app próprio</span>
              )}
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(integration.active)}`}>
                {integration.active ? 'ativa' : 'inativa'}
              </span>
              <button onClick={() => startEdit(integration)} className={btnSecondary} title="Editar">
                <Pencil size={14} />
              </button>
              <button
                onClick={() => toggle(integration)}
                disabled={busy === integration.id}
                className={integration.active ? btnDanger : btnSecondary}
                title={integration.active ? 'Desativar' : 'Reativar'}
              >
                {busy === integration.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : integration.active ? <Trash2 size={14} /> : <RotateCcw size={14} />}
              </button>
            </div>
          ))}
        </div>
      ) : !showForm ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm dark:bg-[#111b21]">
          <ShoppingBag size={40} className="mx-auto mb-3 text-[#aebac1]" />
          <p className="font-semibold dark:text-[#e9edef]">Nenhuma loja conectada</p>
          <p className="mt-1 text-sm text-[#667781]">Conecte sua loja Shopify para importar pedidos automaticamente.</p>
          <button onClick={() => setShowForm(true)} className={`${btnPrimary} mx-auto mt-4`}>
            + Conectar primeira loja
          </button>
        </div>
      ) : null}
    </div>
  )
}

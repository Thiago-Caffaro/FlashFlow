'use client'

import { useState } from 'react'
import {
  CheckCircle, Loader2, Pencil, RefreshCw,
  RotateCcw, Save, ShoppingBag, Trash2,
} from 'lucide-react'
import { Account, ShopifyIntegration } from '@/types'

type ShopifyIntegrationForm = {
  shop_name: string
  shop_domain: string
  admin_token: string
  webhook_secret: string
  default_country: string
  active: boolean
  confirmation_message_template: string
  recovery_message_template: string
}

const emptyForm: ShopifyIntegrationForm = {
  shop_name: '', shop_domain: '', admin_token: '', webhook_secret: '',
  default_country: '', active: true,
  confirmation_message_template: '', recovery_message_template: '',
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

  function showMsg(text: string, error = false) {
    setMessage({ text, error })
    setTimeout(() => setMessage(null), 5000)
  }

  function startEdit(integration: ShopifyIntegration) {
    setEditingId(integration.id)
    setForm({
      shop_name: integration.shop_name,
      shop_domain: integration.shop_domain,
      admin_token: '',
      webhook_secret: '',
      default_country: integration.default_country,
      active: integration.active,
      confirmation_message_template: integration.confirmation_message_template ?? '',
      recovery_message_template: integration.recovery_message_template ?? '',
    })
    setShowForm(true)
    setActiveStep(1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelForm() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
    setActiveStep(1)
  }

  async function save() {
    setBusy('save')
    const res = await fetch('/api/fulfillment/shopify/integrations', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, id: editingId ?? undefined }),
    })
    const json = await getJson(res)
    if (json.ok) {
      showMsg(editingId ? 'Loja atualizada.' : 'Loja conectada com sucesso!')
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
    { n: 1, label: 'Credenciais' },
    { n: 2, label: 'Sincronização' },
    { n: 3, label: 'Mensagens' },
    { n: 4, label: 'WhatsApp' },
  ]

  const canSave = Boolean(form.shop_name && form.shop_domain && form.default_country)

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

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
            <p className="mt-0.5 text-xs text-[#667781]">Token Admin e webhook secret são criptografados antes de serem armazenados.</p>
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
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Nome da loja</label>
                  <input
                    className={inputClass}
                    placeholder="Minha Loja"
                    value={form.shop_name}
                    onChange={(e) => setForm((f) => ({ ...f, shop_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Domínio Shopify</label>
                  <input
                    className={inputClass}
                    placeholder="loja.myshopify.com"
                    value={form.shop_domain}
                    onChange={(e) => setForm((f) => ({ ...f, shop_domain: e.target.value.toLowerCase() }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Encontre em Admin Shopify → Configurações → Informações da Loja</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Admin API Token</label>
                  <input
                    className={inputClass}
                    type="password"
                    placeholder={editingId ? 'Deixe vazio para manter o atual' : 'shpat_...'}
                    value={form.admin_token}
                    onChange={(e) => setForm((f) => ({ ...f, admin_token: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">
                    Admin Shopify → Configurações → Apps e canais de vendas → Desenvolver apps → Criar app privado
                  </p>
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
              </>
            )}

            {activeStep === 2 && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Webhook Secret</label>
                  <input
                    className={inputClass}
                    placeholder={editingId ? 'Deixe vazio para manter o atual' : 'shpss_...'}
                    value={form.webhook_secret}
                    onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Admin Shopify → Configurações → Notificações → Webhooks</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-900/20">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">Modo de sincronização: manual</p>
                  <p className="mt-1 text-amber-700 dark:text-amber-400">
                    O sistema ainda não recebe webhooks em tempo real do Shopify.
                    Use o botão <strong>Sincronizar</strong> para importar pedidos e carrinhos manualmente.
                  </p>
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                    A sincronização lê os pedidos mais recentes e envia confirmações por WhatsApp automaticamente.
                  </p>
                </div>
              </>
            )}

            {activeStep === 3 && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#667781]">Mensagem de confirmação de pedido</label>
                  <p className="mb-2 text-xs text-[#667781]">
                    Variáveis:
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{nome}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{pedido}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{total}}'}</span>
                    {' '}<span className={VAR_HINT_CLASSES}>{'{{currency}}'}</span>
                  </p>
                  <textarea
                    className={`${inputClass} resize-y`}
                    rows={4}
                    placeholder={'Olá, {{nome}}!\nRecebemos seu pedido {{pedido}} no valor de {{currency}} {{total}}.\nResponda esta mensagem para confirmar a entrega.'}
                    value={form.confirmation_message_template}
                    onChange={(e) => setForm((f) => ({ ...f, confirmation_message_template: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[#667781]">Deixe em branco para usar o modelo padrão.</p>
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
              </>
            )}

            {activeStep === 4 && (
              <>
                <p className="text-sm text-[#667781]">
                  Configure quais contas WhatsApp enviam mensagens para os pedidos desta loja.
                  Menor número de prioridade = prioridade mais alta.
                </p>
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
              {(activeStep === 4 || editingId) && (
                <button onClick={save} disabled={busy === 'save' || !canSave} className={btnPrimary}>
                  {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editingId ? 'Salvar' : 'Conectar loja'}
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

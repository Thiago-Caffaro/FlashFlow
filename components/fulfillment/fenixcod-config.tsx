'use client'

import { useState } from 'react'
import {
  CheckCircle, ChevronDown, ChevronUp, FlaskConical,
  KeyRound, Loader2, Pencil, RotateCcw, Save, ShieldCheck, Trash2,
} from 'lucide-react'

export type Integration = {
  id: string
  country: string
  environment: 'test' | 'production'
  active: boolean
  token_expires_at: string | null
}

type IntegrationForm = {
  country: string
  email: string
  password: string
  environment: 'test' | 'production'
}

const emptyIntegrationForm: IntegrationForm = { country: '', email: '', password: '', environment: 'production' }

interface FenixCODConfigProps {
  integrations: Integration[]
  onRefresh: () => Promise<void>
}

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

function statusClass(active: boolean) {
  return active
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#aebac1]'
}

async function getJson(res: Response) {
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
}

export default function FenixCODConfig({
  integrations, onRefresh,
}: FenixCODConfigProps) {
  const [integrationForm, setIntegrationForm] = useState<IntegrationForm>(emptyIntegrationForm)
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const [testCountry, setTestCountry] = useState(integrations.filter((i) => i.active)[0]?.country ?? '')
  const [testSku, setTestSku] = useState('')
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showIntegrationForm, setShowIntegrationForm] = useState(false)

  function showMsg(text: string, error = false) {
    setMessage({ text, error })
    setTimeout(() => setMessage(null), 5000)
  }

  async function saveIntegration() {
    setBusy('integration')
    const res = await fetch('/api/fulfillment/integrations', {
      method: editingIntegrationId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...integrationForm, id: editingIntegrationId ?? undefined }),
    })
    const json = await getJson(res)
    showMsg(
      json.ok
        ? (editingIntegrationId ? 'Credenciais atualizadas.' : 'Login validado e integração salva.')
        : (json.error ?? 'Erro ao salvar.'),
      !json.ok,
    )
    if (json.ok) {
      setIntegrationForm(emptyIntegrationForm)
      setEditingIntegrationId(null)
      setShowIntegrationForm(false)
      await onRefresh()
    }
    setBusy(null)
  }

  async function toggleIntegration(integration: Integration) {
    setBusy(integration.id)
    const res = integration.active
      ? await fetch(`/api/fulfillment/integrations?id=${encodeURIComponent(integration.id)}`, { method: 'DELETE' })
      : await fetch('/api/fulfillment/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: integration.id, country: integration.country, environment: 'production', active: true }),
      })
    const json = await getJson(res)
    showMsg(
      json.ok ? (integration.active ? 'Integração desativada.' : 'Integração reativada.') : (json.error ?? 'Erro.'),
      !json.ok,
    )
    if (json.ok) await onRefresh()
    setBusy(null)
  }

  async function runTest(action: 'connection' | 'stock') {
    setTestBusy(true)
    setTestResult(null)
    const json = await fetch('/api/fulfillment/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, country: testCountry, sku: testSku }),
    }).then(getJson) as Record<string, unknown>
    setTestResult(json)
    setTestBusy(false)
  }

  const activeIntegrations = integrations.filter((i) => i.active)

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-[#e7f8f4] text-[#008f72]'}`}>
          {message.text}
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center gap-3 rounded-xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e7f8f4]">
          <ShieldCheck size={18} className="text-[#00a884]" />
        </div>
        <div>
          <h2 className="font-bold dark:text-[#e9edef]">FenixCOD</h2>
          <p className="text-xs text-[#667781]">Credenciais de acesso à API European Fulfillment.</p>
        </div>
      </div>

      {/* Credentials */}
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
          <button
            onClick={() => setShowIntegrationForm((v) => !v)}
            className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#1a2730]"
          >
            <KeyRound size={16} className="shrink-0 text-[#00a884]" />
            <div className="flex-1">
              <p className="text-sm font-bold dark:text-[#e9edef]">
                {editingIntegrationId ? 'Editar credenciais' : 'Credenciais por país'}
              </p>
              <p className="text-xs text-[#667781]">
                {integrations.length > 0
                  ? `${integrations.length} país(es) configurado(s)`
                  : 'Nenhuma credencial configurada — clique para adicionar'}
              </p>
            </div>
            {showIntegrationForm ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
          </button>

          {showIntegrationForm && (
            <div className="space-y-3 border-t border-[#f0f2f5] px-5 py-4 dark:border-[#2a3942]">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">País</label>
                <input
                  className={inputClass}
                  disabled={Boolean(editingIntegrationId)}
                  placeholder="SPAIN"
                  value={integrationForm.country}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">E-mail</label>
                <input
                  className={inputClass}
                  placeholder="email@exemplo.com"
                  value={integrationForm.email}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#667781]">Senha</label>
                <input
                  className={inputClass}
                  type="password"
                  placeholder="••••••••"
                  value={integrationForm.password}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, password: e.target.value }))}
                />
                <p className="mt-1 text-xs text-[#667781]">As credenciais salvas não são exibidas. Preencha para substituir ou validar.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveIntegration}
                  disabled={busy === 'integration' || !integrationForm.country || !integrationForm.email || !integrationForm.password}
                  className={btnPrimary}
                >
                  {busy === 'integration' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editingIntegrationId ? 'Salvar' : 'Validar e salvar'}
                </button>
                <button
                  onClick={() => {
                    setEditingIntegrationId(null)
                    setIntegrationForm(emptyIntegrationForm)
                    setShowIntegrationForm(false)
                  }}
                  className={btnSecondary}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {integrations.map((integration) => (
          <div key={integration.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm dark:bg-[#111b21]">
            <CheckCircle size={16} className={integration.active ? 'text-[#00a884]' : 'text-[#aebac1]'} />
            <div className="min-w-32 flex-1">
              <b className="text-sm dark:text-[#e9edef]">{integration.country}</b>
              <p className="text-xs text-[#667781]">
                {integration.environment} · Token até {integration.token_expires_at ? new Date(integration.token_expires_at).toLocaleDateString('pt-BR') : '–'}
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(integration.active)}`}>
              {integration.active ? 'ativa' : 'inativa'}
            </span>
            <button
              onClick={() => {
                setEditingIntegrationId(integration.id)
                setIntegrationForm({ country: integration.country, email: '', password: '', environment: integration.environment })
                setShowIntegrationForm(true)
              }}
              className={btnSecondary}
              title="Editar"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => toggleIntegration(integration)}
              disabled={busy === integration.id}
              className={integration.active ? 'flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-40 dark:bg-red-900/20 dark:hover:bg-red-900/30' : btnSecondary}
              title={integration.active ? 'Desativar' : 'Reativar'}
            >
              {busy === integration.id
                ? <Loader2 size={13} className="animate-spin" />
                : integration.active ? <Trash2 size={13} /> : <RotateCcw size={13} />}
            </button>
          </div>
        ))}

        {integrations.length === 0 && (
          <p className="rounded-xl bg-white p-4 text-sm text-[#667781] shadow-sm dark:bg-[#111b21]">
            Nenhuma integração FenixCOD configurada.
          </p>
        )}
      </div>

      {/* Advanced (collapsible) */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-[#111b21]">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#1a2730]"
        >
          <FlaskConical size={16} className="text-[#667781]" />
          <span className="flex-1 text-sm font-semibold text-[#667781] dark:text-[#aebac1]">Avançado</span>
          {showAdvanced ? <ChevronUp size={16} className="text-[#667781]" /> : <ChevronDown size={16} className="text-[#667781]" />}
        </button>

        {showAdvanced && (
          <div className="border-t border-[#f0f2f5] p-5 dark:border-[#2a3942]">
            {/* Connection test */}
            <div>
              <h4 className="mb-2 text-sm font-semibold dark:text-[#e9edef]">Testar conexão FenixCOD</h4>
              <div className="space-y-2">
                <select
                  value={testCountry}
                  onChange={(e) => setTestCountry(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecionar integração...</option>
                  {activeIntegrations.map((i) => (
                    <option key={i.id} value={i.country}>{i.country} · {i.environment}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    disabled={testBusy || !testCountry}
                    onClick={() => runTest('connection')}
                    className={btnPrimary}
                  >
                    {testBusy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    Testar login
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    placeholder="SKU para verificar estoque"
                    value={testSku}
                    onChange={(e) => setTestSku(e.target.value)}
                  />
                  <button
                    disabled={testBusy || !testCountry || !testSku}
                    onClick={() => runTest('stock')}
                    className={btnSecondary}
                  >
                    Estoque
                  </button>
                </div>
                {testResult && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#0b141a] p-3 text-xs text-[#e9edef]">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

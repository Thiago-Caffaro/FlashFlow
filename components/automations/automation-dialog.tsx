'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Loader2, Plus, ShoppingCart, X } from 'lucide-react'
import type {
  Account,
  AutomationInput,
  AutomationKind,
  AutomationStepInput,
  AutomationWithSteps,
  CatalogPlatform,
  ProductLineWithProducts,
} from '@/types'
import { AUTOMATION_PRESETS } from '@/lib/automation-presets'
import { AUTOMATION_COUNTRIES } from '@/lib/automation-display'
import type { FallbackTemplateOption } from '@/components/flows/template-fallback-picker'
import AutomationStepEditor from './automation-step-editor'

interface AutomationDialogProps {
  // null = criar nova
  automation: AutomationWithSteps | null
  lines: ProductLineWithProducts[]
  accounts: Account[]
  onSaved: () => void
  onClose: () => void
}

type WizardStep = 'modelo' | 'publico' | 'lembretes'

const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: 'modelo', label: 'Modelo' },
  { id: 'publico', label: 'Para quem' },
  { id: 'lembretes', label: 'Lembretes' },
]

const PLATFORM_LABELS: Record<CatalogPlatform, string> = { shopify: 'Shopify', lightfunnels: 'Lightfunnels' }

const inputClass =
  'w-full rounded-xl border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2 text-sm text-[#111b21] outline-none transition-colors focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#e9edef]'

function initialForm(automation: AutomationWithSteps | null): AutomationInput {
  if (automation) {
    return {
      name: automation.name,
      kind: automation.kind,
      platform: automation.platform,
      country: automation.country,
      product_line_id: automation.product_line_id,
      instance_name: automation.instance_name,
      enabled: automation.enabled,
      steps: automation.steps.map((step) => ({
        delay_minutes: step.delay_minutes,
        message: step.message,
        fallback_template_id: step.fallback_template_id,
        fallback_template_variable_map: step.fallback_template_variable_map ?? {},
      })),
    }
  }
  const preset = AUTOMATION_PRESETS.abandoned_cart
  return {
    name: '',
    kind: preset.kind,
    platform: preset.platforms[0],
    country: '',
    product_line_id: null,
    instance_name: '',
    enabled: false,
    steps: preset.defaultSteps.map((step) => ({ ...step })),
  }
}

// Assistente de criação/edição: modelo → país, linha e número → lembretes.
// A validação definitiva é do servidor; aqui só o que impede avançar.
export default function AutomationDialog({ automation, lines, accounts, onSaved, onClose }: AutomationDialogProps) {
  const [form, setForm] = useState<AutomationInput>(() => initialForm(automation))
  const [wizardStep, setWizardStep] = useState<WizardStep>(automation ? 'lembretes' : 'modelo')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customVariableKeys, setCustomVariableKeys] = useState<string[]>([])
  const [templates, setTemplates] = useState<FallbackTemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesRefreshing, setTemplatesRefreshing] = useState(false)

  const preset = AUTOMATION_PRESETS[form.kind]
  const realAccounts = useMemo(() => accounts.filter((account) => !account.isSandbox), [accounts])
  const selectedAccount = realAccounts.find((account) => account.instanceName === form.instance_name) ?? null
  const isCloudApi = selectedAccount?.provider === 'cloud_api'
  const stepIndex = WIZARD_STEPS.findIndex((item) => item.id === wizardStep)

  const update = (patch: Partial<AutomationInput>) => setForm((current) => ({ ...current, ...patch }))

  // Variáveis personalizadas e templates dependem do número escolhido.
  useEffect(() => {
    if (!form.instance_name) return
    let cancelled = false
    fetch(`/api/message-variables?instance=${encodeURIComponent(form.instance_name)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.ok) {
          setCustomVariableKeys((json.variables ?? []).map((variable: { key: string }) => variable.key))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [form.instance_name])

  useEffect(() => {
    if (!form.instance_name || !isCloudApi) return
    let cancelled = false
    setTemplatesLoading(true)
    fetch(`/api/whatsapp-cloud/templates?instance=${encodeURIComponent(form.instance_name)}`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled && json.ok) setTemplates(json.templates ?? []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTemplatesLoading(false) })
    return () => { cancelled = true }
  }, [form.instance_name, isCloudApi])

  const refreshTemplates = useCallback(async () => {
    if (!form.instance_name) return
    setTemplatesRefreshing(true)
    try {
      await fetch('/api/whatsapp-cloud/templates/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: form.instance_name }),
      })
      const res = await fetch(`/api/whatsapp-cloud/templates?instance=${encodeURIComponent(form.instance_name)}`)
      const json = await res.json()
      if (json.ok) setTemplates(json.templates ?? [])
    } catch {
      // mantém a lista atual — o botão pode ser clicado de novo
    } finally {
      setTemplatesRefreshing(false)
    }
  }, [form.instance_name])

  function stepProblem(step: WizardStep): string | null {
    if (step === 'modelo') return preset.platforms.includes(form.platform) ? null : 'Escolha a plataforma'
    if (step === 'publico') {
      if (!form.country) return 'Escolha o país'
      if (!form.instance_name) return 'Escolha o número de WhatsApp'
      return null
    }
    for (const [index, item] of form.steps.entries()) {
      if (!item.message.trim()) return `Lembrete ${index + 1}: escreva a mensagem`
      if (item.delay_minutes < 1) return `Lembrete ${index + 1}: informe o tempo de espera`
      if (index > 0 && item.delay_minutes <= form.steps[index - 1].delay_minutes) {
        return `Lembrete ${index + 1}: o tempo deve ser maior que o do lembrete anterior`
      }
      if (isCloudApi && !item.fallback_template_id) return `Lembrete ${index + 1}: escolha um template aprovado`
    }
    return null
  }

  function goTo(target: WizardStep) {
    const targetIndex = WIZARD_STEPS.findIndex((item) => item.id === target)
    // Avançar exige as etapas anteriores completas; voltar é livre.
    for (const item of WIZARD_STEPS.slice(0, targetIndex)) {
      const problem = stepProblem(item.id)
      if (problem) {
        setWizardStep(item.id)
        setError(problem)
        return
      }
    }
    setError(null)
    setWizardStep(target)
  }

  function setStep(index: number, step: AutomationStepInput) {
    update({ steps: form.steps.map((current, i) => (i === index ? step : current)) })
  }

  function addStep() {
    const last = form.steps[form.steps.length - 1]
    update({
      steps: [...form.steps, {
        delay_minutes: (last?.delay_minutes ?? 0) + 24 * 60,
        message: '',
        fallback_template_id: null,
        fallback_template_variable_map: {},
      }],
    })
  }

  async function save() {
    const problem = WIZARD_STEPS.map((item) => stepProblem(item.id)).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(automation ? `/api/automations/${automation.id}` : '/api/automations', {
        method: automation ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!response.ok || !json.ok) {
        setError(json.error ?? `Erro ${response.status}`)
        return
      }
      onSaved()
    } catch {
      setError('Falha de conexão')
    } finally {
      setSaving(false)
    }
  }

  const presetEntries = Object.values(AUTOMATION_PRESETS)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={automation ? 'Editar automação' : 'Nova automação'}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl dark:bg-[#111b21] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e9edef] px-5 py-4 dark:border-[#2a3942]">
          <h3 className="text-base font-semibold text-[#111b21] dark:text-[#e9edef]">
            {automation ? 'Editar automação' : 'Nova automação'}
          </h3>
          <button type="button" onClick={onClose} title="Fechar" className="rounded-lg p-1.5 text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]">
            <X size={18} />
          </button>
        </div>

        <ol className="flex gap-2 px-5 pt-4">
          {WIZARD_STEPS.map((item, index) => (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => goTo(item.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
                  item.id === wizardStep
                    ? 'bg-[#00a884]/10 text-[#008069] dark:text-[#00a884]'
                    : 'text-[#667781] hover:bg-[#f0f2f5] dark:text-[#8696a0] dark:hover:bg-[#2a3942]'
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  index < stepIndex ? 'bg-[#00a884] text-white' : 'bg-[#e9edef] text-[#54656f] dark:bg-[#2a3942] dark:text-[#aebac1]'
                }`}>
                  {index < stepIndex ? <Check size={12} /> : index + 1}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {wizardStep === 'modelo' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Modelo</span>
                {presetEntries.map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    disabled={Boolean(automation) && entry.kind !== form.kind}
                    onClick={() => update({ kind: entry.kind as AutomationKind })}
                    className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-50 ${
                      form.kind === entry.kind
                        ? 'border-[#00a884] bg-[#00a884]/5'
                        : 'border-[#e9edef] hover:border-[#00a884]/50 dark:border-[#2a3942]'
                    }`}
                  >
                    <ShoppingCart size={20} className="mt-0.5 shrink-0 text-[#00a884]" />
                    <span>
                      <span className="block text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{entry.label}</span>
                      <span className="mt-0.5 block text-xs text-[#667781] dark:text-[#8696a0]">{entry.description}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Plataforma</span>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PLATFORM_LABELS) as CatalogPlatform[]).map((platform) => {
                    const available = preset.platforms.includes(platform)
                    return (
                      <button
                        key={platform}
                        type="button"
                        disabled={!available}
                        onClick={() => update({ platform })}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          form.platform === platform
                            ? 'bg-[#00a884] text-white'
                            : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1]'
                        }`}
                      >
                        {PLATFORM_LABELS[platform]}{available ? '' : ' (em breve)'}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 'publico' && (
            <div className="flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">País</span>
                <select value={form.country} onChange={(event) => update({ country: event.target.value })} className={inputClass}>
                  <option value="">Escolha o país…</option>
                  {AUTOMATION_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>{country.name} ({country.code})</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Linha de produto</span>
                <select
                  value={form.product_line_id ?? ''}
                  onChange={(event) => update({ product_line_id: event.target.value || null })}
                  className={inputClass}
                >
                  <option value="">Qualquer linha</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.code}{line.products.length > 0 ? ` — ${line.products.map((product) => product.name).join(', ')}` : ''}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[#8696a0]">
                  A linha é reconhecida pelos produtos vinculados em &quot;Linhas e produtos&quot;. Uma automação de linha
                  específica vence a de &quot;Qualquer linha&quot; do mesmo país.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Número de WhatsApp</span>
                <select
                  value={form.instance_name}
                  onChange={(event) => update({ instance_name: event.target.value })}
                  className={inputClass}
                >
                  <option value="">Escolha o número…</option>
                  {realAccounts.map((account) => {
                    const connected = account.state === 'open'
                    // O número já salvo continua selecionável mesmo desconectado.
                    const selectable = connected || account.instanceName === automation?.instance_name
                    return (
                      <option key={account.instanceName} value={account.instanceName} disabled={!selectable}>
                        {account.label}{account.phone ? ` · ${account.phone}` : ''}
                        {account.provider === 'cloud_api' ? ' · oficial' : ''}
                        {connected ? '' : ' (desconectado)'}
                      </option>
                    )
                  })}
                </select>
                {selectedAccount && selectedAccount.state !== 'open' && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle size={13} /> Este número está desconectado: os lembretes vão falhar até reconectar.
                  </span>
                )}
                {isCloudApi && (
                  <span className="text-xs text-[#8696a0]">
                    Número oficial: cada lembrete precisa de um template aprovado, usado quando o cliente não escreveu nas
                    últimas 24h.
                  </span>
                )}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Nome (opcional)</span>
                <input
                  value={form.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder={form.country ? `${preset.label} ${form.country}` : preset.label}
                  className={inputClass}
                />
              </label>
            </div>
          )}

          {wizardStep === 'lembretes' && (
            <div className="flex flex-col gap-4">
              {form.steps.map((step, index) => (
                <AutomationStepEditor
                  key={index}
                  position={index + 1}
                  step={step}
                  delayLabel={preset.delayLabel}
                  variableGroups={preset.variableGroups}
                  customVariableKeys={customVariableKeys}
                  isCloudApi={isCloudApi}
                  templates={templates}
                  templatesLoading={templatesLoading}
                  templatesRefreshing={templatesRefreshing}
                  canRemove={form.steps.length > 1}
                  onChange={(next) => setStep(index, next)}
                  onRemove={() => update({ steps: form.steps.filter((_, i) => i !== index) })}
                  onRefreshTemplates={() => void refreshTemplates()}
                />
              ))}
              {form.steps.length < preset.maxSteps && (
                <button
                  type="button"
                  onClick={addStep}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[#d1d7db] py-3 text-sm font-medium text-[#54656f] hover:border-[#00a884] hover:text-[#00a884] dark:border-[#3d4f5a] dark:text-[#aebac1]"
                >
                  <Plus size={16} /> Adicionar lembrete
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[#e9edef] px-5 py-4 dark:border-[#2a3942]">
          {error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-red-500">
              <AlertCircle size={15} className="shrink-0" /> {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => (stepIndex > 0 ? goTo(WIZARD_STEPS[stepIndex - 1].id) : onClose())}
              className="rounded-xl px-4 py-2 text-sm font-medium text-[#54656f] hover:bg-[#f0f2f5] dark:text-[#aebac1] dark:hover:bg-[#2a3942]"
            >
              {stepIndex > 0 ? 'Voltar' : 'Cancelar'}
            </button>
            {stepIndex < WIZARD_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => goTo(WIZARD_STEPS[stepIndex + 1].id)}
                className="rounded-xl bg-[#00a884] px-5 py-2 text-sm font-semibold text-white hover:bg-[#008069]"
              >
                Próximo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#00a884] px-5 py-2 text-sm font-semibold text-white hover:bg-[#008069] disabled:opacity-60"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {automation ? 'Salvar' : 'Criar automação'}
              </button>
            )}
          </div>
          {!automation && (
            <p className="text-xs text-[#8696a0]">A automação é criada desligada — ligue no card quando estiver pronta.</p>
          )}
        </div>
      </div>
    </div>
  )
}

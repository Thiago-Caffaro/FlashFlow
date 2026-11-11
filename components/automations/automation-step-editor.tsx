'use client'

import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { AutomationStepInput } from '@/types'
import { AUTOMATIC_MESSAGE_VARIABLES } from '@/lib/message-template'
import { DELAY_UNIT_LABELS, DELAY_UNIT_MINUTES, splitDelay, type DelayUnit } from '@/lib/automation-display'
import TemplateFallbackPicker, { type FallbackTemplateOption } from '@/components/flows/template-fallback-picker'

interface AutomationStepEditorProps {
  step: AutomationStepInput
  // null = envia na hora (sem campo de espera)
  delayLabel: string | null
  // Título do bloco (ex: "Lembrete 1" ou "Mensagem")
  title: string
  variableGroups: string[]
  customVariableKeys: string[]
  isCloudApi: boolean
  templates: FallbackTemplateOption[]
  templatesLoading: boolean
  templatesRefreshing: boolean
  canRemove: boolean
  onChange: (step: AutomationStepInput) => void
  onRemove: () => void
  onRefreshTemplates: () => void
}

const inputClass =
  'rounded-xl border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2 text-sm text-[#111b21] outline-none transition-colors focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#e9edef]'

export default function AutomationStepEditor({
  step,
  delayLabel,
  title,
  variableGroups,
  customVariableKeys,
  isCloudApi,
  templates,
  templatesLoading,
  templatesRefreshing,
  canRemove,
  onChange,
  onRemove,
  onRefreshTemplates,
}: AutomationStepEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const delay = splitDelay(step.delay_minutes)
  const variables = [
    ...AUTOMATIC_MESSAGE_VARIABLES.filter((variable) => variableGroups.includes(variable.group))
      .map((variable) => ({ key: variable.key, label: variable.label })),
    ...customVariableKeys.map((key) => ({ key, label: key })),
  ]

  function setDelay(value: number, unit: DelayUnit) {
    const minutes = Math.round((Number.isFinite(value) ? value : 0) * DELAY_UNIT_MINUTES[unit])
    onChange({ ...step, delay_minutes: minutes })
  }

  // Insere a variável onde está o cursor (ou no fim).
  function insertVariable(key: string) {
    const token = `{{${key}}}`
    const element = textareaRef.current
    const start = element?.selectionStart ?? step.message.length
    const end = element?.selectionEnd ?? step.message.length
    const message = step.message.slice(0, start) + token + step.message.slice(end)
    onChange({ ...step, message })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#e9edef] p-4 dark:border-[#2a3942]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{title}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remover lembrete"
            className="rounded-lg p-1.5 text-[#8696a0] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {delayLabel !== null && <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">{delayLabel}</span>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={delay.value || ''}
            onChange={(event) => setDelay(Number(event.target.value), delay.unit)}
            className={`${inputClass} w-24`}
          />
          <select
            value={delay.unit}
            onChange={(event) => setDelay(delay.value, event.target.value as DelayUnit)}
            className={inputClass}
          >
            {(Object.keys(DELAY_UNIT_LABELS) as DelayUnit[]).map((unit) => (
              <option key={unit} value={unit}>{DELAY_UNIT_LABELS[unit]}</option>
            ))}
          </select>
        </div>
      </label>}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#667781]">Mensagem</span>
        <textarea
          ref={textareaRef}
          value={step.message}
          onChange={(event) => onChange({ ...step, message: event.target.value })}
          rows={5}
          className={`${inputClass} resize-y`}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {variables.map((variable) => (
          <button
            key={variable.key}
            type="button"
            onClick={() => insertVariable(variable.key)}
            title={`Inserir {{${variable.key}}}`}
            className="rounded-full bg-[#00a884]/10 px-2.5 py-1 text-xs font-medium text-[#008069] hover:bg-[#00a884]/20 dark:text-[#00a884]"
          >
            {variable.label}
          </button>
        ))}
      </div>

      {isCloudApi && (
        <TemplateFallbackPicker
          templates={templates}
          loading={templatesLoading}
          refreshing={templatesRefreshing}
          templateId={step.fallback_template_id ?? ''}
          variableMap={step.fallback_template_variable_map}
          replyButtons={[]}
          onChange={(templateId, variableMap) =>
            onChange({ ...step, fallback_template_id: templateId || null, fallback_template_variable_map: variableMap })}
          onRefresh={onRefreshTemplates}
        />
      )}
    </div>
  )
}

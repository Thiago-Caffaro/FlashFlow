'use client'

import { useState } from 'react'
import { Clock, Loader2, Pencil, Phone, Trash2 } from 'lucide-react'
import AutomationKindIcon from './automation-kind-icon'
import type { Account, AutomationWithSteps, ProductLine } from '@/types'
import { AUTOMATION_PRESETS } from '@/lib/automation-presets'
import { countryLabel, formatDelay } from '@/lib/automation-display'

interface AutomationCardProps {
  automation: AutomationWithSteps
  line: ProductLine | null
  account: Account | null
  onToggle: (enabled: boolean) => Promise<boolean>
  onEdit: () => void
  onDelete: () => Promise<boolean>
}

const PLATFORM_LABELS: Record<string, string> = { shopify: 'Shopify', lightfunnels: 'Lightfunnels' }

export default function AutomationCard({ automation, line, account, onToggle, onEdit, onDelete }: AutomationCardProps) {
  const [busy, setBusy] = useState(false)
  const preset = AUTOMATION_PRESETS[automation.kind]
  const disconnected = account ? account.state !== 'open' : true
  const chips: string[] = []
  if (automation.country) chips.push(countryLabel(automation.country))
  if (preset?.usesOrderScope) chips.push(line ? line.code : 'Qualquer linha')
  if (automation.kind === 'delivery_status') {
    const statuses = automation.config?.statuses ?? []
    chips.push(statuses.includes('*') ? 'Qualquer mudança' : statuses.join(', '))
  }
  if (automation.kind === 'message_keyword') {
    chips.push(`${automation.config?.match === 'exact' ? '=' : '∋'} ${automation.config?.keywords ?? ''}`)
  }

  async function toggle() {
    setBusy(true)
    await onToggle(!automation.enabled)
    setBusy(false)
  }

  async function remove() {
    if (!window.confirm(`Apagar a automação "${automation.name}"? Os lembretes ainda não enviados são cancelados.`)) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm dark:bg-[#111b21]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00a884]/10">
            <AutomationKindIcon kind={automation.kind} className="text-[#00a884]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{automation.name}</p>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">
              {preset?.label ?? automation.kind}
              {automation.platform ? ` · ${PLATFORM_LABELS[automation.platform] ?? automation.platform}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={automation.enabled}
          aria-label={automation.enabled ? 'Desligar automação' : 'Ligar automação'}
          onClick={() => void toggle()}
          disabled={busy}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            automation.enabled ? 'bg-[#00a884]' : 'bg-[#d1d7db] dark:bg-[#3d4f5a]'
          }`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${automation.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full bg-[#f0f2f5] px-2.5 py-1 text-[#54656f] dark:bg-[#202c33] dark:text-[#aebac1]">
            {chip}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-[#667781] dark:text-[#8696a0]">
        <span className="flex items-center gap-1.5">
          <Phone size={13} className="shrink-0" />
          <span className="truncate">
            {account ? `${account.label}${account.phone ? ` · ${account.phone}` : ''}` : automation.instance_name}
          </span>
          {disconnected && <span className="font-medium text-amber-600 dark:text-amber-400">desconectado</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={13} className="shrink-0" />
          {automation.steps.length === 0
            ? 'Sem mensagem'
            : preset?.delayLabel === null
              ? 'Envia na hora'
              : automation.steps.map((step) => formatDelay(step.delay_minutes)).join(' → ')}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#e9edef] pt-3 dark:border-[#2a3942]">
        <span className={`text-xs font-medium ${automation.enabled ? 'text-[#00a884]' : 'text-[#8696a0]'}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : automation.enabled ? 'Ligada' : 'Desligada'}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#54656f] hover:bg-[#f0f2f5] dark:text-[#aebac1] dark:hover:bg-[#2a3942]"
          >
            <Pencil size={13} /> Editar
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            title="Apagar automação"
            className="rounded-lg p-1.5 text-[#8696a0] hover:bg-red-50 hover:text-red-500 disabled:opacity-60 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

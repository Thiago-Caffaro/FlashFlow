'use client'

import { useState } from 'react'
import { GitBranch, Pencil, Trash2 } from 'lucide-react'
import { Trigger, TriggerCreate, TriggerTipo, TriggerAction } from '@/types'

interface TriggerRowProps {
  trigger: Trigger
  instanceName: string
  onUpdate: (id: string, changes: Partial<TriggerCreate>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpenModal: (trigger: Trigger) => void
  onOpenFlowPicker: (trigger: Trigger) => void
}

const DELAY_OPTIONS = [
  { label: 'Imediato', value: 0 },
  { label: '1s', value: 1000 },
  { label: '5s', value: 5000 },
  { label: 'Personalizado', value: -1 },
]

const TIPO_OPTIONS: { label: string; value: TriggerTipo }[] = [
  { label: 'Contém', value: 'contains' },
  { label: 'Igual a', value: 'exact' },
]

const ACTION_OPTIONS: { label: string; value: TriggerAction }[] = [
  { label: 'Enviar msg', value: 'send_message' },
  { label: 'Fluxo', value: 'flow' },
]

function resolveDelayOption(delay_ms: number): number {
  if (delay_ms === 0) return 0
  if (delay_ms === 1000) return 1000
  if (delay_ms === 5000) return 5000
  return -1
}

export default function TriggerRow({ trigger, onUpdate, onDelete, onOpenModal, onOpenFlowPicker }: TriggerRowProps) {
  const [localAlias, setLocalAlias] = useState(trigger.alias)
  const [localValor, setLocalValor] = useState(trigger.valor)
  const [editingField, setEditingField] = useState<'alias' | 'valor' | null>(null)
  const [customDelaySeconds, setCustomDelaySeconds] = useState(
    resolveDelayOption(trigger.delay_ms) === -1 ? String(trigger.delay_ms / 1000) : ''
  )
  const [deleting, setDeleting] = useState(false)

  const currentDelayOption = resolveDelayOption(trigger.delay_ms)

  async function handleDelayChange(value: number) {
    if (value === -1) return
    await onUpdate(trigger.id, { delay_ms: value })
  }

  async function handleCustomDelayBlur() {
    const seconds = parseFloat(customDelaySeconds)
    if (isNaN(seconds) || seconds < 0) return
    await onUpdate(trigger.id, { delay_ms: Math.round(seconds * 1000) })
  }

  async function handleActionChange(value: TriggerAction) {
    await onUpdate(trigger.id, { action: value })
    if (value === 'send_message') {
      onOpenModal({ ...trigger, action: value })
    } else if (value === 'flow') {
      onOpenFlowPicker({ ...trigger, action: value })
    }
  }

  async function handleDelete() {
    setDeleting(true)
    await onDelete(trigger.id)
  }

  const selectClass =
    'w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded px-1 py-1 outline-none focus:border-[#00a884] cursor-pointer'

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#f0f2f5] dark:border-[#2a3942] hover:bg-[#fafafa] dark:hover:bg-[#182229] group">
      {/* Alias */}
      <div className="flex-1 min-w-0">
        {editingField === 'alias' ? (
          <input
            autoFocus
            value={localAlias}
            onChange={(e) => setLocalAlias(e.target.value)}
            onBlur={() => {
              onUpdate(trigger.id, { alias: localAlias })
              setEditingField(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#00a884] rounded px-1 py-0.5 outline-none"
          />
        ) : (
          <span
            onClick={() => setEditingField('alias')}
            className="block truncate text-xs text-[#111b21] dark:text-[#e9edef] cursor-text px-1 py-0.5 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] rounded"
            title="Clique para editar o nome"
          >
            {localAlias || <em className="text-[#aebac1] dark:text-[#667781] not-italic">Nome...</em>}
          </span>
        )}
      </div>

      {/* Tipo */}
      <div className="w-[90px] shrink-0">
        <select
          value={trigger.tipo}
          onChange={(e) => onUpdate(trigger.id, { tipo: e.target.value as TriggerTipo })}
          className={selectClass}
        >
          {TIPO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Valor */}
      <div className="flex-1 min-w-0">
        {editingField === 'valor' ? (
          <input
            autoFocus
            value={localValor}
            onChange={(e) => setLocalValor(e.target.value)}
            onBlur={() => {
              onUpdate(trigger.id, { valor: localValor })
              setEditingField(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#00a884] rounded px-1 py-0.5 outline-none"
          />
        ) : (
          <span
            onClick={() => setEditingField('valor')}
            className="block truncate text-xs text-[#111b21] dark:text-[#e9edef] cursor-text px-1 py-0.5 hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] rounded font-mono"
            title="Clique para editar o valor"
          >
            {localValor || <em className="text-[#aebac1] dark:text-[#667781] not-italic font-sans">Valor...</em>}
          </span>
        )}
      </div>

      {/* Delay */}
      <div className="shrink-0 flex items-center gap-1">
        <select
          value={currentDelayOption}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v !== -1) handleDelayChange(v)
          }}
          className="text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded px-1 py-1 outline-none focus:border-[#00a884] cursor-pointer w-[84px]"
        >
          {DELAY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {currentDelayOption === -1 && (
          <input
            type="number"
            min="0"
            step="0.5"
            value={customDelaySeconds}
            onChange={(e) => setCustomDelaySeconds(e.target.value)}
            onBlur={handleCustomDelayBlur}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="seg"
            className="w-[44px] text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded px-1 py-1 outline-none focus:border-[#00a884]"
          />
        )}
      </div>

      {/* Ação */}
      <div className="shrink-0 flex items-center gap-0.5">
        <select
          value={trigger.action}
          onChange={(e) => handleActionChange(e.target.value as TriggerAction)}
          className="text-xs text-[#111b21] dark:text-[#e9edef] bg-white dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded px-1 py-1 outline-none focus:border-[#00a884] cursor-pointer w-[80px]"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {trigger.action === 'send_message' && (
          <button
            onClick={() => onOpenModal(trigger)}
            className="p-1 rounded text-[#aebac1] dark:text-[#667781] hover:text-[#00a884] hover:bg-[#e7f8f4] dark:hover:bg-[#182229] transition-colors"
            title="Editar mensagem"
          >
            <Pencil size={12} />
          </button>
        )}
        {trigger.action === 'flow' && (
          <button
            onClick={() => onOpenFlowPicker(trigger)}
            className={`p-1 rounded transition-colors ${
              trigger.action_payload?.flow_id
                ? 'text-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27]'
                : 'text-[#aebac1] dark:text-[#667781] hover:text-[#00a884] hover:bg-[#e7f8f4] dark:hover:bg-[#182229]'
            }`}
            title={trigger.action_payload?.flow_id ? 'Trocar fluxo' : 'Selecionar fluxo'}
          >
            <GitBranch size={12} />
          </button>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="p-1 rounded text-[#aebac1] dark:text-[#667781] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40 shrink-0"
        title="Remover gatilho"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

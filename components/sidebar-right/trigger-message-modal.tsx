'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Trigger } from '@/types'

interface TriggerMessageModalProps {
  trigger: Trigger
  onSave: (id: string, message: string) => Promise<void>
  onClose: () => void
}

export default function TriggerMessageModal({ trigger, onSave, onClose }: TriggerMessageModalProps) {
  const [message, setMessage] = useState(trigger.action_payload.message ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!message.trim()) return
    setSaving(true)
    await onSave(trigger.id, message)
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-[#233138] rounded-xl shadow-xl p-5 w-[420px] space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Mensagem automática</p>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-[#667781] dark:text-[#8696a0]">
          Gatilho:{' '}
          <strong className="text-[#111b21] dark:text-[#e9edef]">{trigger.alias || 'sem nome'}</strong>
          {' — '}
          {trigger.tipo === 'contains' ? 'Contém' : 'Igual a'}{' '}
          {trigger.valor ? (
            <span className="font-mono bg-[#f0f2f5] dark:bg-[#2a3942] px-1 rounded">&quot;{trigger.valor}&quot;</span>
          ) : (
            <em className="text-[#aebac1] dark:text-[#667781]">valor não definido</em>
          )}
        </p>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Digite a mensagem de resposta automática..."
          className="w-full border border-[#d1d7db] dark:border-[#2a3942] dark:bg-[#2a3942] dark:text-[#e9edef] rounded-lg px-3 py-2 text-sm text-[#111b21] outline-none focus:border-[#00a884] resize-none transition-colors placeholder:text-[#aebac1] dark:placeholder:text-[#667781]"
        />

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#d1d7db] dark:border-[#2a3942] text-sm text-[#667781] dark:text-[#8696a0] hover:bg-[#f5f6f6] dark:hover:bg-[#182229] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !message.trim()}
            className="flex-1 py-2 rounded-lg bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

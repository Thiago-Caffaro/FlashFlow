'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { AISessionWithContext } from '@/types'

interface TerminateSessionDialogProps {
  sessionWithCtx: AISessionWithContext
  onClose: () => void
  onConfirm: (id: string, message: string, useFlowMessage: boolean) => Promise<void>
}

export default function TerminateSessionDialog({ sessionWithCtx, onClose, onConfirm }: TerminateSessionDialogProps) {
  const [message, setMessage] = useState('')
  const [useFlowMessage, setUseFlowMessage] = useState(false)
  const [loading, setLoading] = useState(false)

  const { session, conversation, flow_name } = sessionWithCtx
  const displayName = conversation.contact_name || conversation.contact_phone

  async function handleConfirm() {
    setLoading(true)
    await onConfirm(session.id, message.trim(), useFlowMessage)
    setLoading(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-[#233138] rounded-xl shadow-xl p-5 w-[460px] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-[#ef4444]" />
            <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Encerrar sessão</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-[#667781] dark:text-[#8696a0]">
          Encerrando sessão de{' '}
          <strong className="text-[#111b21] dark:text-[#e9edef]">{displayName}</strong>
          {flow_name && (
            <> no fluxo <strong className="text-[#111b21] dark:text-[#e9edef]">{flow_name}</strong></>
          )}
          . Escolha uma mensagem de encerramento ou deixe em branco.
        </p>

        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value); if (e.target.value) setUseFlowMessage(false) }}
          rows={4}
          placeholder="Mensagem de encerramento (opcional)..."
          disabled={useFlowMessage}
          className="w-full border border-[#d1d7db] dark:border-[#2a3942] dark:bg-[#2a3942] dark:text-[#e9edef] rounded-lg px-3 py-2 text-sm text-[#111b21] outline-none focus:border-[#00a884] resize-none transition-colors placeholder:text-[#aebac1] dark:placeholder:text-[#667781] disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useFlowMessage}
            onChange={(e) => { setUseFlowMessage(e.target.checked); if (e.target.checked) setMessage('') }}
            className="w-4 h-4 accent-[#00a884]"
          />
          <span className="text-xs text-[#667781] dark:text-[#8696a0]">
            Usar mensagem de encerramento do fluxo
          </span>
        </label>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#d1d7db] dark:border-[#2a3942] text-sm text-[#667781] dark:text-[#8696a0] hover:bg-[#f5f6f6] dark:hover:bg-[#182229] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-[#ef4444] text-white text-sm font-medium hover:bg-[#dc2626] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Encerrando...' : 'Encerrar sessão'}
          </button>
        </div>
      </div>
    </div>
  )
}

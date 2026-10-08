'use client'

import { useRef } from 'react'
import { BellRing } from 'lucide-react'
import { FlowNode, FlowNodeData } from '@/types'
import VariablePicker from './variable-picker'

interface Props {
  node: FlowNode
  instanceName: string
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}

export default function NotificationConfig({ node, instanceName, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const message = typeof node.data.notificationMessage === 'string' ? node.data.notificationMessage : ''

  function insertVariable(key: string) {
    const placeholder = `{{${key}}}`
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? message.length
    const end = textarea?.selectionEnd ?? message.length
    onChange(node.id, {
      notificationMessage: `${message.slice(0, start)}${placeholder}${message.slice(end)}`,
    })
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + placeholder.length, start + placeholder.length)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg bg-rose-50 p-3 text-rose-800 dark:bg-rose-950/20 dark:text-rose-200">
        <BellRing size={16} className="mt-0.5 shrink-0" />
        <p className="text-xs leading-relaxed">Cria um alerta interno para os operadores quando o fluxo passar por este no.</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor={`notification-${node.id}`} className="text-xs font-semibold uppercase text-[#667781] dark:text-[#8696a0]">Mensagem</label>
          <span className="text-[11px] text-[#8696a0]">{message.length}/2000</span>
        </div>
        <textarea
          ref={textareaRef}
          id={`notification-${node.id}`}
          rows={8}
          maxLength={2000}
          value={message}
          onChange={(event) => onChange(node.id, { notificationMessage: event.target.value })}
          placeholder="Ex: {{contato.nome_completo}} precisa de acompanhamento no pedido {{pedido.numero}}."
          className="w-full resize-y rounded-lg border border-[#d1d7db] bg-[#f8f9fa] px-3 py-3 text-sm leading-relaxed text-[#111b21] outline-none focus:border-[#e11d48] dark:border-[#3d4f5a] dark:bg-[#182229] dark:text-[#e9edef]"
        />
      </div>

      <VariablePicker instanceName={instanceName} onInsert={insertVariable} />
    </div>
  )
}

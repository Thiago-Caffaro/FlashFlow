'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Loader2, Search } from 'lucide-react'
import { FlowNode, FlowNodeData, MessageVariable } from '@/types'
import { AUTOMATIC_MESSAGE_VARIABLES } from '@/lib/message-template'

interface Props {
  node: FlowNode
  instanceName: string
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}

export default function NotificationConfig({ node, instanceName, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [customVariables, setCustomVariables] = useState<MessageVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const message = typeof node.data.notificationMessage === 'string' ? node.data.notificationMessage : ''

  const loadVariables = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/message-variables?instance=${encodeURIComponent(instanceName)}`)
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar variaveis')
      setCustomVariables(json.variables ?? [])
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar variaveis')
    } finally {
      setLoading(false)
    }
  }, [instanceName])

  useEffect(() => {
    void loadVariables()
  }, [loadVariables])

  const automaticVariables = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return AUTOMATIC_MESSAGE_VARIABLES
    return AUTOMATIC_MESSAGE_VARIABLES.filter((variable) => (
      variable.label.toLocaleLowerCase().includes(normalized)
      || variable.key.toLocaleLowerCase().includes(normalized)
    ))
  }, [query])

  const filteredCustomVariables = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return customVariables
    return customVariables.filter((variable) => (
      variable.label.toLocaleLowerCase().includes(normalized)
      || variable.key.toLocaleLowerCase().includes(normalized)
    ))
  }, [customVariables, query])

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

      <div className="border-t border-[#e4e7e9] pt-4 dark:border-[#2a3942]">
        <p className="mb-3 text-xs font-semibold uppercase text-[#667781] dark:text-[#8696a0]">Inserir variavel</p>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar variavel"
            className="w-full rounded-lg bg-[#f0f2f5] py-2 pl-9 pr-3 text-sm text-[#111b21] outline-none focus:ring-1 focus:ring-[#e11d48] dark:bg-[#2a3942] dark:text-[#e9edef]"
          />
        </div>
        <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase text-[#8696a0]">Automaticas</p>
            {automaticVariables.map((variable) => (
              <button
                type="button"
                key={variable.key}
                onClick={() => insertVariable(variable.key)}
                title={variable.description}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
              >
                <span className="text-xs font-medium text-[#111b21] dark:text-[#e9edef]">{variable.label}</span>
                <code className="text-[11px] text-[#008f72]">{`{{${variable.key}}}`}</code>
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase text-[#8696a0]">Personalizadas</p>
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-[#8696a0]"><Loader2 size={13} className="animate-spin" />Carregando...</div>
            ) : error ? (
              <p className="px-2 py-2 text-xs text-red-500">{error}</p>
            ) : filteredCustomVariables.length === 0 ? (
              <p className="px-2 py-2 text-xs text-[#8696a0]">Nenhuma variavel personalizada.</p>
            ) : filteredCustomVariables.map((variable) => (
              <button
                type="button"
                key={variable.id}
                onClick={() => insertVariable(`personalizada.${variable.key}`)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
              >
                <span className="truncate text-xs font-medium text-[#111b21] dark:text-[#e9edef]">{variable.label}</span>
                <code className="shrink-0 text-[11px] text-[#008f72]">{`{{personalizada.${variable.key}}}`}</code>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

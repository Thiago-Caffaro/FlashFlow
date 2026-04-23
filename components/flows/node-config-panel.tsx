'use client'

import { X } from 'lucide-react'
import { FlowNode, FlowNodeData } from '@/types'

interface Props {
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
  onClose: () => void
}

const inputClass =
  'w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-2 py-1.5 outline-none focus:border-[#00a884] transition-colors resize-none'

const labelClass = 'text-[10px] font-semibold text-[#667781] uppercase tracking-wide mb-1 block'

export default function NodeConfigPanel({ node, onChange, onClose }: Props) {
  const { type, data } = node

  return (
    <div className="absolute right-0 top-0 bottom-0 w-64 bg-white dark:bg-[#111b21] border-l border-[#f0f2f5] dark:border-[#2a3942] flex flex-col z-10 shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">Configurar nó</span>
        <button onClick={onClose} className="p-1 rounded text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {type === 'start' && (
          <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nó de início do fluxo. Não requer configuração.</p>
        )}

        {type === 'end' && (
          <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nó de fim do fluxo. Não requer configuração.</p>
        )}

        {type === 'sendMessage' && (
          <div>
            <label className={labelClass}>Mensagem</label>
            <textarea
              rows={5}
              value={data.message ?? ''}
              onChange={(e) => onChange(node.id, { message: e.target.value })}
              placeholder="Digite a mensagem a enviar..."
              className={inputClass}
            />
          </div>
        )}

        {type === 'condition' && (
          <>
            <div>
              <label className={labelClass}>Tipo de comparação</label>
              <select
                value={data.conditionType ?? 'contains'}
                onChange={(e) => onChange(node.id, { conditionType: e.target.value as 'contains' | 'exact' })}
                className={inputClass}
              >
                <option value="contains">Contém</option>
                <option value="exact">Igual a</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Valor</label>
              <input
                type="text"
                value={data.conditionValue ?? ''}
                onChange={(e) => onChange(node.id, { conditionValue: e.target.value })}
                placeholder="Texto a comparar..."
                className={inputClass}
              />
            </div>
            <p className="text-[10px] text-[#aebac1] dark:text-[#667781]">
              Saída <span className="text-[#00a884] font-semibold">Sim</span> = condição verdadeira &nbsp;·&nbsp; Saída <span className="text-red-400 font-semibold">Não</span> = falsa
            </p>
          </>
        )}

        {type === 'aiAssistant' && (
          <>
            <div>
              <label className={labelClass}>System Prompt</label>
              <textarea
                rows={6}
                value={data.systemPrompt ?? ''}
                onChange={(e) => onChange(node.id, { systemPrompt: e.target.value })}
                placeholder="Você é um atendente da empresa X..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Histórico (nº de msgs)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={data.historyLimit ?? 10}
                onChange={(e) => onChange(node.id, { historyLimit: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Temperatura (0–1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={data.temperature ?? 0.7}
                onChange={(e) => onChange(node.id, { temperature: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Modelo</label>
              <select
                value={data.model ?? 'gemini-2.0-flash'}
                onChange={(e) => onChange(node.id, { model: e.target.value })}
                className={inputClass}
              >
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

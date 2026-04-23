'use client'

import { useEffect, useState } from 'react'
import { X, GitBranch, Power, PowerOff } from 'lucide-react'
import { Flow } from '@/types'

interface Props {
  instanceName: string
  selectedFlowId: string | null
  onSelect: (flowId: string, flowName: string) => void
  onClose: () => void
}

export default function FlowPickerModal({ instanceName, selectedFlowId, onSelect, onClose }: Props) {
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/flows?instance=${encodeURIComponent(instanceName)}`)
      .then((r) => r.json())
      .then((json) => { if (json.ok) setFlows(json.flows) })
      .finally(() => setLoading(false))
  }, [instanceName])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#111b21] rounded-2xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col overflow-hidden border border-[#f0f2f5] dark:border-[#2a3942]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch size={14} className="text-[#00a884]" />
            <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Selecionar Fluxo</span>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Flow list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">Carregando fluxos...</p>
            </div>
          ) : flows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 gap-1">
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nenhum fluxo criado ainda.</p>
              <p className="text-[10px] text-[#aebac1] dark:text-[#667781]">Crie um fluxo na aba Fluxos primeiro.</p>
            </div>
          ) : (
            flows.map((flow) => {
              const isSelected = flow.id === selectedFlowId
              return (
                <button
                  key={flow.id}
                  onClick={() => { onSelect(flow.id, flow.name); onClose() }}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl mb-1 text-left transition-colors ${
                    isSelected
                      ? 'bg-[#e7f8f4] dark:bg-[#0d2e27] border border-[#00a884]'
                      : 'hover:bg-[#f0f2f5] dark:hover:bg-[#182229] border border-transparent'
                  }`}
                >
                  <div className={`mt-0.5 p-1.5 rounded-lg ${isSelected ? 'bg-[#00a884]' : 'bg-[#f0f2f5] dark:bg-[#2a3942]'}`}>
                    <GitBranch size={12} className={isSelected ? 'text-white' : 'text-[#667781]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef] truncate">{flow.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {flow.ativo ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-[#00a884]">
                          <Power size={8} /> Ativo
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[10px] text-[#aebac1] dark:text-[#667781]">
                          <PowerOff size={8} /> Inativo
                        </span>
                      )}
                      <span className="text-[10px] text-[#aebac1] dark:text-[#667781]">·</span>
                      <span className="text-[10px] text-[#aebac1] dark:text-[#667781]">
                        {flow.json.nodes.length} nó{flow.json.nodes.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-semibold text-[#00a884] shrink-0 self-center">Selecionado</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

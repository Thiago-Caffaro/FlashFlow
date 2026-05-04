'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { Shuffle, MessageSquare } from 'lucide-react'
import { FlowNodeData, SwitchCase } from '@/types'

// Fixed row height — must match the CSS height of each case/default row
const HEADER_H = 56  // header section height in px
const ROW_H = 36     // height of each case row and the default row in px

export default function SwitchCaseNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const cases = (data.cases ?? []) as SwitchCase[]

  return (
    <div
      className={`rounded-xl border-2 bg-white dark:bg-[#182229] min-w-[240px] max-w-[400px] w-max shadow-sm transition-colors overflow-visible ${selected ? 'border-[#3b82f6]' : 'border-[#93c5fd] dark:border-[#1e3a5f]'}`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-[#93c5fd] !border-2 !border-white" />

      {/* Header section — height matches HEADER_H */}
      <div className="px-3 pt-2 pb-2" style={{ height: HEADER_H }}>
        <div className="flex items-center gap-2 mb-2">
          <Shuffle size={12} className="text-[#3b82f6] shrink-0" />
          <span className="text-[10px] font-semibold text-[#667781] uppercase tracking-wide">Switch Case</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942]">
          <MessageSquare size={10} className="text-[#667781] shrink-0" />
          <span className="text-[9px] text-[#667781]">Mensagem inicial do cliente</span>
        </div>
      </div>

      {/* Case rows — each exactly ROW_H px tall */}
      {cases.length === 0 ? (
        <div
          className="px-3 border-t border-[#f0f2f5] dark:border-[#2a3942] flex items-center"
          style={{ height: ROW_H }}
        >
          <em className="text-[10px] text-[#aebac1] dark:text-[#667781] not-italic">
            Nenhum case configurado...
          </em>
        </div>
      ) : (
        cases.map((c, i) => (
          <div
            key={c.id}
            className="px-3 border-t border-[#f0f2f5] dark:border-[#2a3942] flex items-center gap-2"
            style={{ height: ROW_H }}
          >
            <span className="text-[9px] font-semibold text-[#3b82f6] shrink-0">Case {i + 1}</span>
            <span className="text-[10px] text-[#111b21] dark:text-[#e9edef] font-mono truncate">
              {c.conditionType === 'exact' ? '==' : '∋'}{' '}
              {c.value ? `"${c.value}"` : <em className="not-italic text-[#aebac1]">vazio</em>}
            </span>
          </div>
        ))
      )}

      {/* Default row */}
      <div
        className="px-3 border-t border-[#f0f2f5] dark:border-[#2a3942] flex items-center gap-2 rounded-b-xl"
        style={{ height: ROW_H }}
      >
        <span className="text-[9px] font-semibold text-[#9ca3af] shrink-0">Default</span>
        <span className="text-[9px] text-[#aebac1] dark:text-[#667781]">quando nenhum case bate</span>
      </div>

      {/* Source handles on the right — one per case + default */}
      {cases.map((c, i) => (
        <Handle
          key={c.id}
          type="source"
          position={Position.Right}
          id={`case-${i}`}
          style={{ top: HEADER_H + i * ROW_H + ROW_H / 2 }}
          className="!w-3 !h-3 !bg-[#3b82f6] !border-2 !border-white"
        />
      ))}
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        style={{ top: HEADER_H + cases.length * ROW_H + ROW_H / 2 }}
        className="!w-3 !h-3 !bg-[#9ca3af] !border-2 !border-white"
      />
    </div>
  )
}

'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { Sparkles } from 'lucide-react'
import { FlowNodeData } from '@/types'

export default function AiAssistantNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  return (
    <div className={`px-3 py-2 rounded-xl border-2 bg-white dark:bg-[#182229] min-w-[180px] shadow-sm transition-colors ${selected ? 'border-[#8b5cf6]' : 'border-[#c4b5fd] dark:border-[#4c1d95]'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-[#c4b5fd] !border-2 !border-white" />
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles size={12} className="text-[#8b5cf6] shrink-0" />
        <span className="text-[10px] font-semibold text-[#667781] uppercase tracking-wide">IA (Gemini)</span>
      </div>
      <p className="text-xs text-[#111b21] dark:text-[#e9edef] line-clamp-2 min-h-[2em]">
        {data.systemPrompt
          ? data.systemPrompt
          : <em className="text-[#aebac1] dark:text-[#667781] not-italic">Definir prompt...</em>}
      </p>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-[#c4b5fd] !border-2 !border-white" />
    </div>
  )
}

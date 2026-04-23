'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import { FlowNodeData } from '@/types'

export default function ConditionNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  return (
    <div className={`px-3 py-2 rounded-xl border-2 bg-white dark:bg-[#182229] min-w-[180px] shadow-sm transition-colors ${selected ? 'border-[#f59e0b]' : 'border-[#fcd34d] dark:border-[#78450f]'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-[#fcd34d] !border-2 !border-white" />
      <div className="flex items-center gap-2 mb-1.5">
        <GitBranch size={12} className="text-[#f59e0b] shrink-0" />
        <span className="text-[10px] font-semibold text-[#667781] uppercase tracking-wide">Condição</span>
      </div>
      <p className="text-xs text-[#111b21] dark:text-[#e9edef] font-mono truncate">
        {data.conditionValue
          ? `${data.conditionType === 'exact' ? '==' : '∋'} "${data.conditionValue}"`
          : <em className="text-[#aebac1] dark:text-[#667781] not-italic font-sans">Definir condição...</em>}
      </p>
      {/* Two outputs: true (right) and false (left) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '30%' }}
        className="!w-3 !h-3 !bg-[#00a884] !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '70%' }}
        className="!w-3 !h-3 !bg-red-400 !border-2 !border-white"
      />
      <div className="flex justify-between mt-1 px-1">
        <span className="text-[9px] text-[#00a884] font-medium">Sim</span>
        <span className="text-[9px] text-red-400 font-medium">Não</span>
      </div>
    </div>
  )
}

'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { MessageSquare } from 'lucide-react'
import { FlowNodeData } from '@/types'

export default function SendMessageNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  return (
    <div className={`px-3 py-2 rounded-xl border-2 bg-white dark:bg-[#182229] min-w-[160px] max-w-[400px] w-max shadow-sm transition-colors ${selected ? 'border-[#00a884]' : 'border-[#d1d7db] dark:border-[#3d4f5a]'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-[#d1d7db] dark:!bg-[#3d4f5a] !border-2 !border-white" />
      <div className="flex items-center gap-2 mb-1.5">
        <MessageSquare size={12} className="text-[#00a884] shrink-0" />
        <span className="text-[10px] font-semibold text-[#667781] uppercase tracking-wide">Enviar Msg</span>
      </div>
      <p className="text-xs text-[#111b21] dark:text-[#e9edef] break-words whitespace-pre-wrap line-clamp-10 min-h-[2em]">
        {data.message || <em className="text-[#aebac1] dark:text-[#667781] not-italic">Clique para editar...</em>}
      </p>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-[#d1d7db] dark:!bg-[#3d4f5a] !border-2 !border-white" />
    </div>
  )
}

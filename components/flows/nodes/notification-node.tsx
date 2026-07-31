'use client'

import { Handle, NodeProps, Position } from '@xyflow/react'
import { BellRing } from 'lucide-react'
import { FlowNodeData } from '@/types'

export default function NotificationNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  return (
    <div className={`min-w-[180px] max-w-[360px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-colors dark:bg-[#182229] ${selected ? 'border-[#e11d48]' : 'border-[#d1d7db] dark:border-[#3d4f5a]'}`}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-white !bg-[#d1d7db] dark:!bg-[#3d4f5a]" />
      <div className="mb-1.5 flex items-center gap-2">
        <BellRing size={12} className="shrink-0 text-[#e11d48]" />
        <span className="text-[10px] font-semibold uppercase text-[#667781]">Notificar</span>
      </div>
      <p className="line-clamp-6 min-h-[2em] whitespace-pre-wrap break-words text-xs text-[#111b21] dark:text-[#e9edef]">
        {data.notificationMessage || <em className="not-italic text-[#aebac1] dark:text-[#667781]">Clique para configurar...</em>}
      </p>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-white !bg-[#d1d7db] dark:!bg-[#3d4f5a]" />
    </div>
  )
}

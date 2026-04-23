'use client'

import { Handle, Position } from '@xyflow/react'
import { Play } from 'lucide-react'

export default function StartNode() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] min-w-[120px] shadow-sm">
      <div className="p-1 rounded-full bg-[#00a884]">
        <Play size={10} className="text-white fill-white" />
      </div>
      <span className="text-xs font-semibold text-[#00a884]">Início</span>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-[#00a884] !border-2 !border-white" />
    </div>
  )
}

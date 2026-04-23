'use client'

import { Handle, Position } from '@xyflow/react'
import { StopCircle } from 'lucide-react'

export default function EndNode() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/30 min-w-[120px] shadow-sm">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-red-400 !border-2 !border-white" />
      <div className="p-1 rounded-full bg-red-400">
        <StopCircle size={10} className="text-white" />
      </div>
      <span className="text-xs font-semibold text-red-400">Fim</span>
    </div>
  )
}

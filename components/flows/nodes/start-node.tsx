'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { Lock, Play } from 'lucide-react'

export default function StartNode({ selected }: NodeProps) {
  return (
    <div
      className={`relative flex flex-col px-4 py-3 rounded-2xl border-2 min-w-[180px] shadow-md transition-shadow ${
        selected
          ? 'border-[#00a884] shadow-[0_0_0_3px_#00a88422]'
          : 'border-[#00a884] shadow-sm'
      } bg-gradient-to-br from-[#e7f8f4] to-[#d4f3ec] dark:from-[#0d2e27] dark:to-[#0a2620]`}
    >
      {/* Lock badge — indicates permanent */}
      <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#00a884] flex items-center justify-center shadow-sm">
        <Lock size={9} className="text-white" />
      </div>

      <div className="flex items-center gap-2 mb-1">
        <div className="p-1.5 rounded-full bg-[#00a884]">
          <Play size={11} className="text-white fill-white" />
        </div>
        <span className="text-xs font-bold text-[#00a884] tracking-wide uppercase">Início do Fluxo</span>
      </div>
      <p className="text-[10px] text-[#00a884]/70 dark:text-[#00a884]/60 leading-tight">
        Ponto de entrada permanente
      </p>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3.5 !h-3.5 !bg-[#00a884] !border-2 !border-white"
      />
    </div>
  )
}

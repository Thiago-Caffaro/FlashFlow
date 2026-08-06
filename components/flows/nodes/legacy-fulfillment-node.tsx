'use client'

import { Handle, NodeProps, Position } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import { FlowNodeData, FlowNodeType } from '@/types'

const LABELS: Partial<Record<FlowNodeType, string>> = {
  fulfillmentStock: 'Estoque (obsoleto)',
  fulfillmentStatus: 'Status do pedido (obsoleto)',
}

export default function LegacyFulfillmentNode({ data, selected, type }: NodeProps & { data: FlowNodeData; type?: FlowNodeType }) {
  return (
    <div className={`min-w-[200px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm dark:bg-[#182229] ${
      selected ? 'border-amber-500' : 'border-amber-200 dark:border-amber-900'
    }`}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-white !bg-amber-400" />
      <div className="mb-1.5 flex items-center gap-2">
        <AlertTriangle size={13} className="text-amber-500" />
        <span className="text-[10px] font-semibold uppercase text-[#667781]">
          {LABELS[type ?? 'fulfillmentStatus']}
        </span>
      </div>
      <p className="text-xs text-[#667781]">Mantido apenas para fluxos existentes.</p>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-white !bg-amber-400" />
    </div>
  )
}

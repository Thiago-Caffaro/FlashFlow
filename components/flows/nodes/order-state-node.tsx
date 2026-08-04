'use client'

import { Handle, NodeProps, Position } from '@xyflow/react'
import { Database } from 'lucide-react'
import { FlowNodeData, type OrderStateField } from '@/types'
import { ORDER_STATE_FIELDS } from '@/lib/order-state'

function fieldLabel(field: OrderStateField | undefined): string {
  return ORDER_STATE_FIELDS.find((option) => option.value === field)?.label ?? 'Campo não definido'
}

export default function OrderStateNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const configured = Boolean(data.orderStateField && data.orderStateValue)

  return (
    <div className={`min-w-[210px] max-w-[320px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-colors dark:bg-[#182229] ${
      selected ? 'border-[#0f766e]' : 'border-[#99f6e4] dark:border-[#134e4a]'
    }`}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-white !bg-[#14b8a6]" />
      <div className="mb-2 flex items-center gap-2">
        <Database size={13} className="shrink-0 text-[#0f766e] dark:text-[#5eead4]" />
        <span className="text-[10px] font-semibold uppercase text-[#667781]">Capturar Dados</span>
      </div>
      {configured ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-[#667781]">{fieldLabel(data.orderStateField)}</p>
          <p className="break-words text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">
            → {data.orderStateValue}
          </p>
        </div>
      ) : (
        <p className="text-xs italic text-[#aebac1] dark:text-[#667781]">Clique para configurar...</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-white !bg-[#14b8a6]" />
    </div>
  )
}

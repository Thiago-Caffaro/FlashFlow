'use client'

import { Handle, NodeProps, Position } from '@xyflow/react'
import { PackageCheck, PackagePlus, PackageSearch } from 'lucide-react'
import { FlowNodeData, FlowNodeType } from '@/types'

const META: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  fulfillmentStock: { label: 'Consultar estoque', color: '#0ea5e9', Icon: PackageCheck },
  fulfillmentOrder: { label: 'Criar pedido', color: '#10b981', Icon: PackagePlus },
  fulfillmentStatus: { label: 'Status do pedido', color: '#6366f1', Icon: PackageSearch },
}

export default function FulfillmentActionNode({ data, selected, type }: NodeProps & { data: FlowNodeData; type?: FlowNodeType }) {
  const meta = META[type ?? 'fulfillmentStock']
  return (
    <div className="min-w-[190px] rounded-xl border-2 bg-white px-3 py-2 shadow-sm dark:bg-[#182229]" style={{ borderColor: selected ? meta.color : `${meta.color}66` }}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-white" style={{ background: meta.color }} />
      <div className="mb-1.5 flex items-center gap-2">
        <meta.Icon size={13} style={{ color: meta.color }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#667781]">{meta.label}</span>
      </div>
      <p className="text-xs text-[#111b21] dark:text-[#e9edef]">{data.label || data.productId || 'Configurar ação...'}</p>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-white" style={{ background: meta.color }} />
    </div>
  )
}


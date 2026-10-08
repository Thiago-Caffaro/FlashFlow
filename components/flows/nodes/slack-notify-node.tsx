'use client'

import { Handle, NodeProps, Position } from '@xyflow/react'
import { Hash, Headset } from 'lucide-react'
import { FlowNodeData } from '@/types'

export default function SlackNotifyNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const handoff = data.slackHandoff !== false
  return (
    <div className={`min-w-[180px] max-w-[360px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-colors dark:bg-[#182229] ${selected ? 'border-[#611f69] dark:border-[#c084fc]' : 'border-[#d1d7db] dark:border-[#3d4f5a]'}`}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-white !bg-[#d1d7db] dark:!bg-[#3d4f5a]" />
      <div className="mb-1.5 flex items-center gap-2">
        <Headset size={12} className="shrink-0 text-[#611f69] dark:text-[#c084fc]" />
        <span className="text-[10px] font-semibold uppercase text-[#667781]">Slack · Atendimento humano</span>
      </div>
      <p className="line-clamp-4 min-h-[2em] whitespace-pre-wrap break-words text-xs text-[#111b21] dark:text-[#e9edef]">
        {data.slackMessage || <em className="not-italic text-[#aebac1] dark:text-[#667781]">Clique para configurar...</em>}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#8696a0]">
        <span className="flex items-center gap-0.5">
          <Hash size={10} />
          {data.slackChannelName || 'canal padrão'}
        </span>
        {handoff && <span className="rounded bg-[#611f69]/10 px-1 text-[#611f69] dark:text-[#c084fc]">encerra fluxo</span>}
      </div>
      {/* Sempre presente: com "encerra fluxo" ligado, conexões de saída
          apenas não são seguidas (evita aresta órfã ao alternar a opção). */}
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-white !bg-[#d1d7db] dark:!bg-[#3d4f5a]" />

    </div>
  )
}

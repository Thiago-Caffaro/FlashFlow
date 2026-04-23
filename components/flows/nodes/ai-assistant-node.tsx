'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { Sparkles, Bot, Radio } from 'lucide-react'
import { FlowNodeData, AIProvider } from '@/types'

const PROVIDER_CONFIG: Record<AIProvider, { label: string; Icon: React.ElementType; color: string }> = {
  gemini:     { label: 'Gemini',     Icon: Sparkles, color: '#8b5cf6' },
  openai:     { label: 'OpenAI',     Icon: Bot,      color: '#10a37f' },
  openrouter: { label: 'OpenRouter', Icon: Radio,    color: '#6366f1' },
}

export default function AiAssistantNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const provider: AIProvider = (data.provider as AIProvider) ?? 'gemini'
  const { label, Icon, color } = PROVIDER_CONFIG[provider]
  const modelName = provider === 'openrouter'
    ? (data.customModel || 'modelo customizado')
    : (data.model || 'modelo padrão')

  const borderColor = selected ? color : color + '66'

  return (
    <div
      className="px-3 py-2 rounded-xl border-2 bg-white dark:bg-[#182229] min-w-[190px] max-w-[400px] w-max shadow-sm transition-colors"
      style={{ borderColor }}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !border-2 !border-white" style={{ background: color + '99' }} />

      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={12} style={{ color }} className="shrink-0" />
        <span className="text-[10px] font-semibold text-[#667781] uppercase tracking-wide">IA · {label}</span>
      </div>

      <p className="text-[10px] text-[#aebac1] dark:text-[#667781] font-mono mb-1 truncate">
        {modelName}
      </p>

      <p className="text-xs text-[#111b21] dark:text-[#e9edef] break-words whitespace-pre-wrap line-clamp-10 min-h-[2em]">
        {data.systemPrompt || <em className="text-[#aebac1] dark:text-[#667781] not-italic">Definir prompt...</em>}
      </p>

      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !border-2 !border-white" style={{ background: color + '99' }} />
    </div>
  )
}

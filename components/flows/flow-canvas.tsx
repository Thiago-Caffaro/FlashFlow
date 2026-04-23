'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  BackgroundVariant,
  Node,
  Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Save, Plus } from 'lucide-react'
import { Flow, FlowNode, FlowEdge, FlowNodeData, FlowNodeType } from '@/types'
import StartNode from './nodes/start-node'
import SendMessageNode from './nodes/send-message-node'
import ConditionNode from './nodes/condition-node'
import AiAssistantNode from './nodes/ai-assistant-node'
import EndNode from './nodes/end-node'
import NodeConfigPanel from './node-config-panel'

const nodeTypes = {
  start: StartNode,
  sendMessage: SendMessageNode,
  condition: ConditionNode,
  aiAssistant: AiAssistantNode,
  end: EndNode,
}

const NODE_PALETTE: { type: FlowNodeType; label: string; color: string }[] = [
  { type: 'sendMessage', label: 'Enviar Msg', color: '#00a884' },
  { type: 'condition',   label: 'Condição',   color: '#f59e0b' },
  { type: 'aiAssistant', label: 'IA (Gemini)', color: '#8b5cf6' },
  { type: 'end',         label: 'Fim',         color: '#f87171' },
]

interface Props {
  flow: Flow
  onBack: () => void
  onSave: (flow: Flow) => Promise<void>
}

function toXyNode(n: FlowNode): Node {
  return { id: n.id, type: n.type, position: n.position, data: n.data }
}

function toXyEdge(e: FlowEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: e.label,
  }
}

export default function FlowCanvas({ flow, onBack, onSave }: Props) {
  const initialNodes: Node[] = useMemo(() => flow.json.nodes.map(toXyNode), [flow])
  const initialEdges: Edge[] = useMemo(() => flow.json.edges.map(toXyEdge), [flow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const selectedNode = selectedNodeId
    ? (nodes.find((n) => n.id === selectedNodeId) as (Node & { data: FlowNodeData }) | undefined)
    : null

  function handleNodeDataChange(id: string, data: Partial<FlowNodeData>) {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
    )
  }

  function addNode(type: FlowNodeType) {
    const id = `${type}-${Date.now()}`
    const position = { x: 200 + Math.random() * 200, y: 150 + Math.random() * 150 }
    const defaults: Record<FlowNodeType, FlowNodeData> = {
      start:        {},
      sendMessage:  { message: '' },
      condition:    { conditionType: 'contains', conditionValue: '' },
      aiAssistant:  { systemPrompt: '', historyLimit: 10, temperature: 0.7, model: 'gemini-2.0-flash' },
      end:          {},
    }
    setNodes((nds) => [...nds, { id, type, position, data: defaults[type] }])
  }

  async function handleSave() {
    setSaving(true)
    const serialized: Flow = {
      ...flow,
      json: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as FlowNodeType,
          position: n.position,
          data: n.data as FlowNodeData,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          label: typeof e.label === 'string' ? e.label : undefined,
        })),
      },
    }
    await onSave(serialized)
    setSaving(false)
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors"
        >
          <ArrowLeft size={14} />
          Fluxos
        </button>
        <div className="w-px h-4 bg-[#f0f2f5] dark:bg-[#2a3942]" />
        <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef] flex-1 truncate">{flow.name}</span>

        {/* Node palette */}
        <div className="flex items-center gap-1">
          {NODE_PALETTE.map((item) => (
            <button
              key={item.type}
              onClick={() => addNode(item.type)}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors hover:opacity-80"
              style={{ color: item.color, borderColor: item.color + '44', background: item.color + '11' }}
            >
              <Plus size={10} />
              {item.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#00a884] text-white hover:bg-[#008f72] transition-colors disabled:opacity-60"
        >
          <Save size={12} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode="Delete"
          className="bg-[#f8f9fa] dark:bg-[#0d1a1f]"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d7db" className="dark:!opacity-30" />
          <Controls className="!bg-white dark:!bg-[#182229] !border !border-[#f0f2f5] dark:!border-[#2a3942]" />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'start') return '#00a884'
              if (n.type === 'end') return '#f87171'
              if (n.type === 'condition') return '#f59e0b'
              if (n.type === 'aiAssistant') return '#8b5cf6'
              return '#d1d7db'
            }}
            className="!bg-white dark:!bg-[#182229] !border !border-[#f0f2f5] dark:!border-[#2a3942]"
          />
        </ReactFlow>

        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode as FlowNode}
            onChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  )
}

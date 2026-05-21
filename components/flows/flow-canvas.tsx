'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  NodeMouseHandler,
  EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Save, Plus, Trash2, Copy, Lock } from 'lucide-react'
import { Flow, FlowNode, FlowEdge, FlowNodeData, FlowNodeType, SwitchCase } from '@/types'
import { FEATURES } from '@/lib/features'
import StartNode from './nodes/start-node'
import SendMessageNode from './nodes/send-message-node'
import ConditionNode from './nodes/condition-node'
import SwitchCaseNode from './nodes/switch-case-node'
import AiAssistantNode from './nodes/ai-assistant-node'
import EndNode from './nodes/end-node'
import NodeConfigPanel from './node-config-panel'
import MessageEditorModal from './message-editor-modal'

const nodeTypes = {
  start: StartNode,
  sendMessage: SendMessageNode,
  condition: ConditionNode,
  switchCase: SwitchCaseNode,
  aiAssistant: AiAssistantNode,
  end: EndNode,
}

const BASE_PALETTE: { type: FlowNodeType; label: string; color: string }[] = [
  { type: 'sendMessage', label: 'Enviar Msg',   color: '#00a884' },
  { type: 'condition',   label: 'Condição',     color: '#f59e0b' },
  { type: 'aiAssistant', label: 'IA (Gemini)',  color: '#8b5cf6' },
  { type: 'end',         label: 'Fim',          color: '#f87171' },
]

const SWITCH_CASE_ITEM: { type: FlowNodeType; label: string; color: string } =
  { type: 'switchCase', label: 'Switch Case', color: '#3b82f6' }

interface ContextMenu {
  x: number
  y: number
  type: 'node' | 'edge' | 'pane'
  targetId?: string
}

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

const START_NODE: Node = {
  id: 'start',
  type: 'start',
  position: { x: 250, y: 60 },
  data: {},
  deletable: false,
}

function ensureStartNode(nodes: Node[]): Node[] {
  return nodes.some((n) => n.id === 'start') ? nodes : [START_NODE, ...nodes]
}

export default function FlowCanvas({ flow, onBack, onSave }: Props) {
  const initialNodes: Node[] = useMemo(
    () => ensureStartNode(flow.json.nodes.map(toXyNode)),
    [flow]
  )
  const initialEdges: Edge[] = useMemo(() => flow.json.edges.map(toXyEdge), [flow])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const onConnect = useCallback(
    (params: Connection) => {
      // Start node: only one outgoing connection
      if (params.source === 'start') {
        const alreadyConnected = edges.some((e) => e.source === 'start')
        if (alreadyConnected) return
      }
      // Per-handle restriction: each sourceHandle can only connect once
      if (params.sourceHandle) {
        const taken = edges.some(
          (e) => e.source === params.source && e.sourceHandle === params.sourceHandle
        )
        if (taken) return
      }
      setEdges((eds) => addEdge(params, eds))
    },
    [setEdges, edges]
  )

  // Close context menu on outside click
  useEffect(() => {
    function handleClick() { setContextMenu(null) }
    if (contextMenu) {
      window.addEventListener('click', handleClick, { once: true })
    }
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    setContextMenu({
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
      type: 'node',
      targetId: node.id,
    })
  }, [])

  const onEdgeContextMenu: EdgeMouseHandler = useCallback((e, edge) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    setContextMenu({
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
      type: 'edge',
      targetId: edge.id,
    })
  }, [])

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    setContextMenu({
      x: (e as MouseEvent).clientX - (rect?.left ?? 0),
      y: (e as MouseEvent).clientY - (rect?.top ?? 0),
      type: 'pane',
    })
  }, [])

  function deleteNode(id: string) {
    if (id === 'start') return // permanent node
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    if (selectedNodeId === id) setSelectedNodeId(null)
    setContextMenu(null)
  }

  function deleteEdge(id: string) {
    setEdges((eds) => eds.filter((e) => e.id !== id))
    setContextMenu(null)
  }

  function duplicateNode(id: string) {
    const node = nodes.find((n) => n.id === id)
    if (!node) return
    const newId = `${node.type}-${Date.now()}`
    setNodes((nds) => [
      ...nds,
      { ...node, id: newId, position: { x: node.position.x + 40, y: node.position.y + 40 } },
    ])
    setContextMenu(null)
  }

  const selectedNode = selectedNodeId
    ? (nodes.find((n) => n.id === selectedNodeId) as (Node & { data: FlowNodeData }) | undefined)
    : null

  function handleNodeDataChange(id: string, data: Partial<FlowNodeData>) {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
    )
    // When cases change on a switchCase node, remove edges referencing deleted handles
    if (data.cases !== undefined) {
      const validHandles = new Set([
        ...(data.cases as SwitchCase[]).map((_, i) => `case-${i}`),
        'default',
      ])
      setEdges((eds) =>
        eds.filter((e) => e.source !== id || !e.sourceHandle || validHandles.has(e.sourceHandle))
      )
    }
  }

  function addNode(type: FlowNodeType) {
    const id = `${type}-${Date.now()}`
    const position = { x: 200 + Math.random() * 200, y: 150 + Math.random() * 150 }
    const defaults: Record<FlowNodeType, FlowNodeData> = {
      start:        {},
      sendMessage:  { message: '' },
      condition:    { conditionType: 'contains', conditionValue: '' },
      switchCase:   { cases: [] },
      aiAssistant:  { systemPrompt: '', historyLimit: 10, temperature: 0.7, model: 'gemini-2.5-flash', continueConversation: true },
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
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-4 px-6 py-4 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors shrink-0"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Fluxos</span>
        </button>

        <div className="w-px h-6 bg-[#f0f2f5] dark:bg-[#2a3942]" />

        <span className="text-base font-bold text-[#111b21] dark:text-[#e9edef] flex-1 truncate">
          {flow.name}
        </span>

        {/* Node palette */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide shrink-0">
            Adicionar nó
          </span>
          <div className="w-px h-5 bg-[#f0f2f5] dark:bg-[#2a3942]" />
          {[...BASE_PALETTE, ...(FEATURES.switchCase ? [SWITCH_CASE_ITEM] : [])].map((item) => (
            <button
              key={item.type}
              onClick={() => addNode(item.type)}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border-2 transition-all hover:scale-[1.03] hover:shadow-sm active:scale-[0.98]"
              style={{
                color: item.color,
                borderColor: item.color + '55',
                background: item.color + '14',
              }}
            >
              <Plus size={15} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-[#f0f2f5] dark:bg-[#2a3942]" />

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl bg-[#00a884] text-white hover:bg-[#008f72] transition-colors disabled:opacity-60 shrink-0 shadow-sm"
        >
          <Save size={16} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 relative" ref={wrapperRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id)
            setContextMenu(null)
          }}
          onPaneClick={() => {
            setSelectedNodeId(null)
            setContextMenu(null)
          }}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
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

        {/* Config panel — not shown for sendMessage (uses modal instead) */}
        {selectedNode && selectedNode.type !== 'sendMessage' && (
          <NodeConfigPanel
            node={selectedNode as FlowNode}
            flowId={flow.id}
            instanceName={flow.instance_name}
            onChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {/* Message editor modal */}
        {selectedNode?.type === 'sendMessage' && (
          <MessageEditorModal
            node={selectedNode as FlowNode}
            onChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
            instanceName={flow.instance_name}
          />
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            className="absolute z-50 min-w-[180px] bg-white dark:bg-[#233138] rounded-xl shadow-xl border border-[#f0f2f5] dark:border-[#2a3942] py-1 overflow-hidden"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'node' && (() => {
              const isStart = contextMenu.targetId === 'start'
              return (
                <>
                  {!isStart && (
                    <>
                      <button
                        onClick={() => duplicateNode(contextMenu.targetId!)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left"
                      >
                        <Copy size={14} className="text-[#667781] dark:text-[#8696a0]" />
                        Duplicar nó
                      </button>
                      <div className="h-px bg-[#f0f2f5] dark:bg-[#2a3942] my-1" />
                      <button
                        onClick={() => deleteNode(contextMenu.targetId!)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                      >
                        <Trash2 size={14} />
                        Excluir nó
                      </button>
                    </>
                  )}
                  {isStart && (
                    <div className="px-4 py-3 text-xs text-[#aebac1] dark:text-[#667781] flex items-center gap-2">
                      <Lock size={11} />
                      Nó permanente — não pode ser excluído
                    </div>
                  )}
                </>
              )
            })()}

            {contextMenu.type === 'edge' && (
              <button
                onClick={() => deleteEdge(contextMenu.targetId!)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
              >
                <Trash2 size={14} />
                Excluir conexão
              </button>
            )}

            {contextMenu.type === 'pane' && (
              <>
                <p className="px-4 py-2 text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">
                  Adicionar nó
                </p>
                {[...BASE_PALETTE, ...(FEATURES.switchCase ? [SWITCH_CASE_ITEM] : [])].map((item) => (
                  <button
                    key={item.type}
                    onClick={() => { addNode(item.type); setContextMenu(null) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors text-left"
                    style={{ color: item.color }}
                  >
                    <Plus size={14} />
                    {item.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

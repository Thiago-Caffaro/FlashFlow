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
import { AlertTriangle, ArrowLeft, Save, Plus, Trash2, Copy, Lock } from 'lucide-react'
import { Flow, FlowNode, FlowEdge, FlowNodeData, FlowNodeType, SwitchCase } from '@/types'
import { FEATURES } from '@/lib/features'
import { findReplyConnectionIssue } from '@/lib/flow-connection-validation'
import { findFirstMessagesWithoutTemplate } from '@/lib/flow-template-lint'
import { isCloudApiAccount as isCloudApiAccountInList } from '@/lib/account-provider-lookup'
import { buildReplyCasesForConnection } from '@/lib/flow-switch-cases'
import StartNode from './nodes/start-node'
import SendMessageNode from './nodes/send-message-node'
import NotificationNode from './nodes/notification-node'
import SlackNotifyNode from './nodes/slack-notify-node'
import ConditionNode from './nodes/condition-node'
import SwitchCaseNode from './nodes/switch-case-node'
import AiAssistantNode from './nodes/ai-assistant-node'
import EndNode from './nodes/end-node'
import OrderStateNode from './nodes/order-state-node'
import LegacyFulfillmentNode from './nodes/legacy-fulfillment-node'
import NodeConfigPanel from './node-config-panel'
import MessageEditorModal from './message-editor-modal'

const nodeTypes = {
  start: StartNode,
  sendMessage: SendMessageNode,
  notify: NotificationNode,
  slackNotify: SlackNotifyNode,
  condition: ConditionNode,
  switchCase: SwitchCaseNode,
  aiAssistant: AiAssistantNode,
  captureOrderData: OrderStateNode,
  fulfillmentStock: LegacyFulfillmentNode,
  fulfillmentStatus: LegacyFulfillmentNode,
  end: EndNode,
}

const BASE_PALETTE: { type: FlowNodeType; label: string; color: string }[] = [
  { type: 'sendMessage', label: 'Enviar Msg',   color: '#00a884' },
  { type: 'notify',      label: 'Notificar',     color: '#e11d48' },
  { type: 'slackNotify', label: 'Slack',        color: '#611f69' },
  { type: 'condition',   label: 'Condição',     color: '#f59e0b' },
  { type: 'aiAssistant', label: 'Agente',       color: '#8b5cf6' },
  { type: 'captureOrderData', label: 'Capturar Dados', color: '#0f766e' },
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const serializedNodes = useMemo<FlowNode[]>(() => nodes.map((node) => ({
    id: node.id,
    type: node.type as FlowNodeType,
    position: node.position,
    data: node.data as FlowNodeData,
  })), [nodes])

  const serializedEdges = useMemo<FlowEdge[]>(() => edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: typeof edge.label === 'string' ? edge.label : undefined,
  })), [edges])

  const replyConnectionIssue = useMemo(
    () => findReplyConnectionIssue(serializedNodes, serializedEdges),
    [serializedNodes, serializedEdges]
  )

  // Conta oficial (Cloud API): a mensagem inicial de um fluxo disparado pelo
  // sistema só chega ao cliente como template. Aviso não bloqueante — o fluxo
  // pode ser sempre iniciado por resposta do cliente, caso em que a janela
  // de 24h já está aberta.
  const [isCloudApiAccount, setIsCloudApiAccount] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/accounts')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        setIsCloudApiAccount(isCloudApiAccountInList(json.accounts, flow.instance_name))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [flow.instance_name])
  const firstMessagesWithoutTemplate = useMemo(
    () => (isCloudApiAccount ? findFirstMessagesWithoutTemplate(serializedNodes, serializedEdges) : []),
    [isCloudApiAccount, serializedNodes, serializedEdges]
  )

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
      const replyCases = buildReplyCasesForConnection(
        serializedNodes,
        params.source,
        params.target
      )
      if (replyCases) {
        setNodes((current) => current.map((node) => (
          node.id === params.target
            ? { ...node, data: { ...node.data, cases: replyCases } }
            : node
        )))
      }
      setEdges((eds) => addEdge(params, eds))
    },
    [setEdges, setNodes, edges, serializedNodes]
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
      notify:       { notificationMessage: '' },
      slackNotify:  { slackTitle: 'Atendimento humano solicitado', slackMessage: '', slackHandoff: true },
      condition:    { conditionType: 'contains', conditionValue: '' },
      switchCase:   { cases: [] },
      aiAssistant:  { systemPrompt: '', historyLimit: 10, temperature: 0.7, model: 'gemini-2.5-flash', continueConversation: true },
      captureOrderData: { orderStateField: 'commercial_status', orderStateValue: 'Confirmado WhatsApp' },
      fulfillmentStock: { successMessage: 'Estoque disponível.', failureMessage: 'Produto indisponível.' },
      fulfillmentStatus: { successMessage: 'Status do seu pedido: {{status}}', failureMessage: 'Não encontrei um pedido para esta conversa.' },
      end:          {},
    }
    setNodes((nds) => [...nds, { id, type, position, data: defaults[type] }])
  }

  async function handleSave() {
    if (replyConnectionIssue) {
      setSaveError(replyConnectionIssue.error)
      return
    }

    setSaving(true)
    setSaveError(null)
    const serialized: Flow = {
      ...flow,
      json: {
        nodes: serializedNodes,
        edges: serializedEdges,
      },
    }
    try {
      await onSave(serialized)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o fluxo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a]">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-[#f0f2f5] bg-white px-3 py-3 dark:border-[#2a3942] dark:bg-[#111b21] sm:gap-4 sm:px-6 sm:py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors shrink-0"
        >
          <ArrowLeft size={18} />
          <span className="hidden font-medium sm:inline">Fluxos</span>
        </button>

        <div className="w-px h-6 bg-[#f0f2f5] dark:bg-[#2a3942]" />

        <span className="min-w-28 flex-1 truncate text-sm font-bold text-[#111b21] dark:text-[#e9edef] sm:text-base">
          {flow.name}
        </span>

        {/* Node palette */}
        <div className="flex shrink-0 items-center gap-2">
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
          disabled={saving || Boolean(replyConnectionIssue)}
          title={replyConnectionIssue?.error}
          className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl bg-[#00a884] text-white hover:bg-[#008f72] transition-colors disabled:opacity-60 shrink-0 shadow-sm"
        >
          <Save size={16} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {(replyConnectionIssue || saveError) && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle size={17} className="shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            {replyConnectionIssue
              ? `${replyConnectionIssue.error} Nó: ${replyConnectionIssue.nodeId}.`
              : saveError}
          </p>
          {replyConnectionIssue && (
            <button
              type="button"
              onClick={() => setNodes((current) => current.map((node) => ({
                ...node,
                selected: node.id === replyConnectionIssue.nodeId,
              })))}
              className="shrink-0 text-sm font-semibold underline underline-offset-2"
            >
              Destacar nó
            </button>
          )}
        </div>
      )}

      {firstMessagesWithoutTemplate.length > 0 && (
        <div className="flex items-center gap-3 border-b border-sky-200 bg-sky-50 px-6 py-3 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          <AlertTriangle size={17} className="shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            {firstMessagesWithoutTemplate.length === 1
              ? `A mensagem inicial "${firstMessagesWithoutTemplate[0].preview}" não tem template.`
              : `${firstMessagesWithoutTemplate.length} mensagens iniciais deste fluxo não têm template.`}
            {' '}Numa conta oficial, se o cliente não tiver escrito nas últimas 24h (ex.: fluxo disparado por pedido), ela não é enviada e o fluxo para.
            Abra a mensagem e escolha um template de fallback.
          </p>
          <button
            type="button"
            onClick={() => setNodes((current) => current.map((node) => ({
              ...node,
              selected: node.id === firstMessagesWithoutTemplate[0].nodeId,
            })))}
            className="shrink-0 text-sm font-semibold underline underline-offset-2"
          >
            Destacar nó
          </button>
        </div>
      )}

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
              if (n.type === 'notify') return '#e11d48'
              if (n.type === 'slackNotify') return '#611f69'
              if (n.type === 'captureOrderData') return '#0f766e'
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

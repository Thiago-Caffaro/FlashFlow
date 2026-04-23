'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, GitBranch, Power, PowerOff, Pencil, Trash2, ExternalLink, Calendar, Hash } from 'lucide-react'
import { Flow } from '@/types'
import FlowCanvas from './flow-canvas'

interface Props {
  instanceName: string
}

// ─── Context panel ────────────────────────────────────────────────────────────

interface PanelProps {
  flow: Flow
  onUpdate: (id: string, changes: Partial<Flow>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onEdit: (flow: Flow) => void
  onClose: () => void
}

function FlowPanel({ flow, onUpdate, onDelete, onEdit, onClose }: PanelProps) {
  const [name, setName] = useState(flow.name)
  const [deleting, setDeleting] = useState(false)

  const inputClass =
    'w-full bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent focus:border-[#00a884] rounded-xl px-4 py-3 text-sm text-[#111b21] dark:text-[#e9edef] outline-none transition-colors placeholder:text-[#aebac1] dark:placeholder:text-[#667781]'

  const labelClass = 'text-xs font-semibold text-[#667781] dark:text-[#8696a0] mb-1.5 block uppercase tracking-wide'

  const nodeCount = flow.json.nodes.length
  const edgeCount = flow.json.edges.length

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-[#00a884]" />
          <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] truncate max-w-[200px]">
            {flow.name}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors"
        >
          Fechar
        </button>
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* Name */}
        <div>
          <label className={labelClass}>Nome do fluxo</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name !== flow.name) onUpdate(flow.id, { name: name.trim() }) }}
            placeholder="Nome do fluxo..."
            className={inputClass}
          />
        </div>

        {/* Status toggle */}
        <div>
          <label className={labelClass}>Status</label>
          <button
            onClick={() => onUpdate(flow.id, { ativo: !flow.ativo })}
            className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 transition-colors text-left ${
              flow.ativo
                ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27]'
                : 'border-[#d1d7db] dark:border-[#3d4f5a] bg-[#f0f2f5] dark:bg-[#2a3942]'
            }`}
          >
            {flow.ativo ? (
              <Power size={16} className="text-[#00a884] shrink-0" />
            ) : (
              <PowerOff size={16} className="text-[#aebac1] dark:text-[#667781] shrink-0" />
            )}
            <div>
              <p className={`text-sm font-medium ${flow.ativo ? 'text-[#00a884]' : 'text-[#aebac1] dark:text-[#667781]'}`}>
                {flow.ativo ? 'Ativo' : 'Inativo'}
              </p>
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">
                {flow.ativo ? 'Fluxo sendo executado quando ativado' : 'Fluxo não será executado'}
              </p>
            </div>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl bg-[#f0f2f5] dark:bg-[#182229]">
            <Hash size={14} className="text-[#aebac1] dark:text-[#667781]" />
            <span className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">{nodeCount}</span>
            <span className="text-[10px] text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Nós</span>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl bg-[#f0f2f5] dark:bg-[#182229]">
            <GitBranch size={14} className="text-[#aebac1] dark:text-[#667781]" />
            <span className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">{edgeCount}</span>
            <span className="text-[10px] text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Conexões</span>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl bg-[#f0f2f5] dark:bg-[#182229]">
            <Calendar size={14} className="text-[#aebac1] dark:text-[#667781]" />
            <span className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">
              {new Date(flow.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
            <span className="text-[10px] text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Criado</span>
          </div>
        </div>

        {/* Open editor */}
        <button
          onClick={() => onEdit(flow)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#00a884] text-white text-sm font-semibold hover:bg-[#008f72] transition-colors"
        >
          <Pencil size={15} />
          Abrir no Editor
          <ExternalLink size={13} className="opacity-70" />
        </button>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <button
          onClick={async () => {
            setDeleting(true)
            await onDelete(flow.id)
            onClose()
          }}
          disabled={deleting}
          className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} />
          {deleting ? 'Removendo...' : 'Remover fluxo'}
        </button>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function FlowsTab({ instanceName }: Props) {
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null)

  const fetchFlows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/flows?instance=${encodeURIComponent(instanceName)}`)
      const json = await res.json()
      if (json.ok) setFlows(json.flows)
    } finally {
      setLoading(false)
    }
  }, [instanceName])

  useEffect(() => { fetchFlows() }, [fetchFlows])

  async function handleCreate() {
    const res = await fetch('/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_name: instanceName, name: 'Novo Fluxo' }),
    })
    const json = await res.json()
    if (json.ok) {
      setFlows((prev) => [...prev, json.flow])
      setSelectedId(json.flow.id)
    }
  }

  async function handleUpdate(id: string, changes: Partial<Flow>) {
    const res = await fetch(`/api/flows/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    const json = await res.json()
    if (json.ok) {
      setFlows((prev) => prev.map((f) => (f.id === id ? json.flow : f)))
      if (editingFlow?.id === id) setEditingFlow(json.flow)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/flows/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setFlows((prev) => prev.filter((f) => f.id !== id))
      if (selectedId === id) setSelectedId(null)
    }
  }

  async function handleSaveCanvas(flow: Flow) {
    await handleUpdate(flow.id, { name: flow.name, json: flow.json })
  }

  if (editingFlow) {
    return (
      <FlowCanvas
        flow={editingFlow}
        onBack={() => setEditingFlow(null)}
        onSave={handleSaveCanvas}
      />
    )
  }

  const filtered = searchQuery
    ? flows.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : flows

  const selectedFlow = flows.find((f) => f.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: table ── */}
      <div className="flex flex-col w-1/2 border-r border-[#f0f2f5] dark:border-[#2a3942] min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
          <div className="flex-1 flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-xl px-3 py-2">
            <Search size={14} className="text-[#aebac1] dark:text-[#667781] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar fluxo..."
              className="flex-1 bg-transparent text-sm text-[#111b21] dark:text-[#e9edef] placeholder-[#aebac1] dark:placeholder-[#667781] outline-none"
            />
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] transition-colors shrink-0"
          >
            <Plus size={14} />
            Novo
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2 border-b border-[#f0f2f5] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] shrink-0">
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Nome</span>
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Nós</span>
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Status</span>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-sm text-[#aebac1] dark:text-[#667781]">Carregando...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <p className="text-sm text-[#aebac1] dark:text-[#667781]">
                {searchQuery ? 'Nenhum fluxo encontrado.' : 'Nenhum fluxo ainda.'}
              </p>
              {!searchQuery && (
                <button onClick={handleCreate} className="text-sm text-[#00a884] hover:underline">
                  Criar primeiro fluxo
                </button>
              )}
            </div>
          ) : (
            filtered.map((f) => {
              const isSelected = f.id === selectedId
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedId(f.id === selectedId ? null : f.id)}
                  className={`w-full grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] text-left transition-colors ${
                    isSelected
                      ? 'bg-[#e7f8f4] dark:bg-[#0d2e27]'
                      : 'hover:bg-[#f8f9fa] dark:hover:bg-[#182229]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${isSelected ? 'text-[#00a884]' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                      {f.name}
                    </p>
                    <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-0.5">
                      {new Date(f.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-[#667781] dark:text-[#8696a0] shrink-0">
                    {f.json.nodes.length}
                  </span>
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    f.ativo
                      ? 'bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                      : 'bg-[#f0f2f5] dark:bg-[#2a3942] text-[#aebac1] dark:text-[#667781]'
                  }`}>
                    {f.ativo ? <Power size={9} /> : <PowerOff size={9} />}
                    {f.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: context panel ── */}
      <div className="flex flex-col w-1/2 min-h-0 bg-white dark:bg-[#111b21]">
        {selectedFlow ? (
          <FlowPanel
            key={selectedFlow.id}
            flow={selectedFlow}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onEdit={setEditingFlow}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="p-4 rounded-2xl bg-[#f0f2f5] dark:bg-[#182229]">
              <GitBranch size={28} className="text-[#aebac1] dark:text-[#667781]" />
            </div>
            <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">Selecione um fluxo</p>
            <p className="text-xs text-[#aebac1] dark:text-[#667781] max-w-[220px]">
              Clique em qualquer fluxo da lista para ver detalhes, editar ou abrir no editor visual.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

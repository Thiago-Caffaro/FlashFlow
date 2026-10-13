'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, GitBranch, Power, PowerOff, Pencil, Trash2, ExternalLink, Calendar, Hash, Download, Upload, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { Flow, ItemFocusRequest, MessageVariable } from '@/types'
import {
  FlowTransferItem,
  FlowTransferVariable,
  getReferencedCustomVariableKeys,
  parseFlowTransfer,
  selectTransferVariables,
} from '@/lib/flow-transfer'
import FlowCanvas from './flow-canvas'

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  instanceName: string
  focus?: ItemFocusRequest | null
}

interface FlowUpdateResult {
  ok: boolean
  error?: string
}

interface PendingImport {
  flows: FlowTransferItem[]
  variablesToCreate: FlowTransferVariable[]
  unresolvedKeys: string[]
  values: Record<string, string>
}

// ─── Context panel ────────────────────────────────────────────────────────────

interface PanelProps {
  flow: Flow
  onUpdate: (id: string, changes: Partial<Flow>) => Promise<FlowUpdateResult>
  onDelete: (id: string) => Promise<void>
  onEdit: (flow: Flow) => void
  onExport: (flow: Flow) => void
  onClose: () => void
}

function FlowPanel({ flow, onUpdate, onDelete, onEdit, onExport, onClose }: PanelProps) {
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

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(flow)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#00a884] text-white text-sm font-semibold hover:bg-[#008f72] transition-colors"
          >
            <Pencil size={15} />
            Abrir no Editor
            <ExternalLink size={13} className="opacity-70" />
          </button>
          <button
            onClick={() => onExport(flow)}
            title="Exportar fluxo como JSON"
            className="flex items-center gap-2 px-4 py-3.5 rounded-xl border-2 border-[#d1d7db] dark:border-[#3d4f5a] text-[#667781] dark:text-[#8696a0] text-sm font-medium hover:border-[#00a884] hover:text-[#00a884] transition-colors"
          >
            <Download size={15} />
          </button>
        </div>
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

export default function FlowsTab({ instanceName, focus = null }: Props) {
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null)
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [transferNotice, setTransferNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

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

  // Abre direto no canvas o fluxo pedido de fora (mini janelas do Sandbox).
  // O nonce já tratado evita reabrir quando a lista recarrega.
  const handledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || handledFocusRef.current === focus.nonce) return
    const flow = flows.find((f) => f.id === focus.id)
    if (!flow) return
    handledFocusRef.current = focus.nonce
    setSelectedId(flow.id)
    setEditingFlow(flow)
  }, [focus, flows])

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
      body: JSON.stringify({ ...changes, instance_name: instanceName }),
    })
    const json = await res.json() as { ok?: boolean; flow?: Flow; error?: unknown }
    if (json.ok && json.flow) {
      const updatedFlow = json.flow
      setFlows((prev) => prev.map((f) => (f.id === id ? updatedFlow : f)))
      if (editingFlow?.id === id) setEditingFlow(updatedFlow)
    }
    return {
      ok: Boolean(json.ok),
      error: typeof json.error === 'string' ? json.error : undefined,
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/flows/${id}?instance=${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setFlows((prev) => prev.filter((f) => f.id !== id))
      if (selectedId === id) setSelectedId(null)
    }
  }

  async function handleSaveCanvas(flow: Flow) {
    const result = await handleUpdate(flow.id, { name: flow.name, json: flow.json })
    if (!result.ok) throw new Error(result.error ?? 'Não foi possível salvar o fluxo.')
  }

  async function fetchMessageVariables(): Promise<MessageVariable[]> {
    const response = await fetch(`/api/message-variables?instance=${encodeURIComponent(instanceName)}`, { cache: 'no-store' })
    const json = await response.json()
    if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar variaveis da conta.')
    return json.variables ?? []
  }

  async function handleExportSingle(flow: Flow) {
    const slug = flow.name.replace(/\s+/g, '-').toLowerCase()
    try {
      const transferFlow = { name: flow.name, ativo: flow.ativo, json: flow.json }
      const variables = selectTransferVariables([transferFlow], await fetchMessageVariables())
      downloadJson(
        { flashflow_export: 'flow', version: 2, ...transferFlow, variables },
        `${slug}.json`
      )
      setTransferNotice(null)
    } catch (error) {
      setTransferNotice({ type: 'error', message: error instanceof Error ? error.message : 'Falha ao exportar fluxo.' })
    }
  }

  async function handleExportAll() {
    const date = new Date().toISOString().slice(0, 10)
    try {
      const transferFlows = flows.map((flow) => ({ name: flow.name, ativo: flow.ativo, json: flow.json }))
      const variables = selectTransferVariables(transferFlows, await fetchMessageVariables())
      downloadJson(
        { flashflow_export: 'flows', version: 2, flows: transferFlows, variables },
        `flashflow-flows-${instanceName}-${date}.json`
      )
      setTransferNotice(null)
    } catch (error) {
      setTransferNotice({ type: 'error', message: error instanceof Error ? error.message : 'Falha ao exportar fluxos.' })
    }
  }

  async function createTransferVariables(variables: FlowTransferVariable[]) {
    for (const variable of variables) {
      const response = await fetch('/api/message-variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_name: instanceName, ...variable }),
      })
      const json = await response.json()
      if (response.status === 409) continue
      if (!response.ok || !json.ok) {
        throw new Error(`Variavel "${variable.key}": ${json.error ?? 'nao foi possivel criar'}`)
      }
    }
  }

  async function importFlows(flowsToImport: FlowTransferItem[], variablesToCreate: FlowTransferVariable[]) {
    await createTransferVariables(variablesToCreate)
    let importedCount = 0
    for (const flow of flowsToImport) {
      const flowName = flow.name?.trim() || 'Fluxo importado'
      const response = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: instanceName,
          name: flowName,
          json: flow.json,
          ativo: flow.ativo ?? true,
        }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) {
        throw new Error(`"${flowName}": ${json.error ?? `falha HTTP ${response.status}`}`)
      }
      importedCount++
    }
    await fetchFlows()
    setTransferNotice({
      type: 'success',
      message: `${importedCount} fluxo${importedCount === 1 ? '' : 's'} importado${importedCount === 1 ? '' : 's'} com sucesso.`,
    })
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    setTransferNotice(null)
    try {
      const parsed = parseFlowTransfer(JSON.parse(await file.text()))
      const existingVariables = await fetchMessageVariables()
      const existingKeys = new Set(existingVariables.map((variable) => variable.key))
      const exportedByKey = new Map(parsed.variables.map((variable) => [variable.key, variable]))
      const missingKeys = getReferencedCustomVariableKeys(parsed.flows)
        .filter((key) => !existingKeys.has(key))
      const variablesToCreate = missingKeys
        .map((key) => exportedByKey.get(key))
        .filter((variable): variable is FlowTransferVariable => Boolean(variable))
      const unresolvedKeys = missingKeys.filter((key) => !exportedByKey.has(key))

      if (unresolvedKeys.length > 0) {
        setPendingImport({
          flows: parsed.flows,
          variablesToCreate,
          unresolvedKeys,
          values: Object.fromEntries(unresolvedKeys.map((key) => [key, ''])),
        })
        return
      }
      await importFlows(parsed.flows, variablesToCreate)
    } catch (error) {
      setTransferNotice({
        type: 'error',
        message: error instanceof SyntaxError
          ? 'O arquivo selecionado nao e um JSON valido.'
          : error instanceof Error ? error.message : 'Falha ao importar fluxo.',
      })
    } finally {
      setImporting(false)
    }
  }

  async function completePendingImport() {
    if (!pendingImport) return
    setImporting(true)
    setTransferNotice(null)
    try {
      const manuallyConfigured = pendingImport.unresolvedKeys.map((key) => ({
        key,
        label: key.replace(/_/g, ' '),
        value: pendingImport.values[key],
      }))
      await importFlows(pendingImport.flows, [...pendingImport.variablesToCreate, ...manuallyConfigured])
      setPendingImport(null)
    } catch (error) {
      setTransferNotice({ type: 'error', message: error instanceof Error ? error.message : 'Falha ao importar fluxo.' })
    } finally {
      setImporting(false)
    }
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
    <div className="relative flex h-full min-h-0">
      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-[#233138]">
            <div className="flex items-center justify-between border-b border-[#e4e7e9] px-5 py-4 dark:border-[#3d4f5a]">
              <div>
                <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Completar variaveis</h2>
                <p className="mt-1 text-xs text-[#667781] dark:text-[#aebac1]">Este arquivo antigo nao inclui os valores usados pelo fluxo.</p>
              </div>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                disabled={importing}
                title="Fechar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-50 dark:text-[#aebac1] dark:hover:bg-[#2a3942]"
              >
                <X size={17} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {pendingImport.unresolvedKeys.map((key) => (
                <div key={key}>
                  <label htmlFor={`import-variable-${key}`} className="mb-1.5 block text-xs font-semibold uppercase text-[#667781] dark:text-[#aebac1]">
                    {key.replace(/_/g, ' ')}
                  </label>
                  <input
                    id={`import-variable-${key}`}
                    value={pendingImport.values[key]}
                    onChange={(event) => setPendingImport((current) => current ? {
                      ...current,
                      values: { ...current.values, [key]: event.target.value },
                    } : null)}
                    placeholder={`Valor para {{personalizada.${key}}}`}
                    maxLength={2000}
                    className="w-full rounded-lg border border-[#d1d7db] bg-[#f0f2f5] px-3 py-2.5 text-sm text-[#111b21] outline-none focus:border-[#00a884] dark:border-[#3d4f5a] dark:bg-[#2a3942] dark:text-[#e9edef]"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-[#e4e7e9] px-5 py-4 dark:border-[#3d4f5a]">
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="flex-1 rounded-lg border border-[#d1d7db] py-2.5 text-sm font-medium text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-50 dark:border-[#3d4f5a] dark:text-[#aebac1] dark:hover:bg-[#2a3942]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void completePendingImport()}
                disabled={importing || pendingImport.unresolvedKeys.some((key) => !pendingImport.values[key]?.trim())}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#00a884] py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50"
              >
                {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Left: table ── */}
      <div className="flex flex-col w-1/2 border-r border-[#f0f2f5] dark:border-[#2a3942] min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
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
            onClick={() => void handleExportAll()}
            title="Exportar todos os fluxos"
            disabled={flows.length === 0}
            className="p-2 rounded-xl text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors disabled:opacity-30 shrink-0"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => importRef.current?.click()}
            title="Importar fluxo(s)"
            disabled={importing}
            className="p-2 rounded-xl text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors disabled:opacity-30 shrink-0"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          </button>
          <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          <button
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] transition-colors shrink-0"
          >
            <Plus size={14} />
            Novo
          </button>
        </div>

        {transferNotice && (
          <div className={`flex items-start gap-2 border-b px-4 py-3 text-xs ${transferNotice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'}`} role={transferNotice.type === 'error' ? 'alert' : 'status'}>
            {transferNotice.type === 'success' ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
            <span className="min-w-0 flex-1">{transferNotice.message}</span>
            <button type="button" onClick={() => setTransferNotice(null)} title="Fechar" className="shrink-0 opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

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
            onExport={handleExportSingle}
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

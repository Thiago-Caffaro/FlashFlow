'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Brain, Tag, X, ChevronRight, Search, Sparkles } from 'lucide-react'
import { AgentMemoryBlock, MemoryBlockType } from '@/types'
import AnalyzeConversationsDialog from './analyze-conversations-dialog'

interface Props {
  instanceName: string
}

const inputClass =
  'w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-4 py-3 outline-none focus:border-[#00a884] transition-colors resize-none'

const labelClass = 'text-xs font-semibold text-[#667781] uppercase tracking-wide mb-2 block'

function TypeBadge({ type }: { type: MemoryBlockType }) {
  return type === 'always' ? (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 uppercase tracking-wide">
      Core
    </span>
  ) : (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 uppercase tracking-wide">
      Contextual
    </span>
  )
}

const EMPTY: Partial<AgentMemoryBlock> = { name: '', content: '', type: 'always', keywords: [] }

export default function MemoryTab({ instanceName }: Props) {
  const [blocks, setBlocks] = useState<AgentMemoryBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<Partial<AgentMemoryBlock>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [analyzeOpen, setAnalyzeOpen] = useState(false)

  const fetchBlocks = useCallback(async () => {
    const res = await fetch(`/api/memory-blocks?instance=${encodeURIComponent(instanceName)}`)
    const json = await res.json()
    if (json.ok) setBlocks(json.blocks)
    setLoading(false)
  }, [instanceName])

  useEffect(() => { fetchBlocks() }, [fetchBlocks])

  function openNew() {
    setSelectedId('new')
    setForm(EMPTY)
    setKeywordInput('')
  }

  function openEdit(block: AgentMemoryBlock) {
    setSelectedId(block.id)
    setForm({ ...block })
    setKeywordInput('')
  }

  function closePanel() {
    setSelectedId(null)
    setForm(EMPTY)
    setKeywordInput('')
  }

  function addKeyword() {
    const kw = keywordInput.trim().toLowerCase()
    if (!kw) return
    const current = form.keywords ?? []
    if (!current.includes(kw)) setForm({ ...form, keywords: [...current, kw] })
    setKeywordInput('')
  }

  function removeKeyword(kw: string) {
    setForm({ ...form, keywords: (form.keywords ?? []).filter((k) => k !== kw) })
  }

  async function save() {
    if (!form.name?.trim() || !form.content?.trim()) return
    setSaving(true)
    try {
      if (selectedId === 'new') {
        const res = await fetch('/api/memory-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_name: instanceName, ...form }),
        })
        const json = await res.json()
        if (json.ok) {
          await fetchBlocks()
          setSelectedId(json.block.id)
          setForm({ ...json.block })
        }
      } else if (selectedId) {
        const res = await fetch(`/api/memory-blocks/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const json = await res.json()
        if (json.ok) {
          await fetchBlocks()
          setForm({ ...json.block })
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteBlock(id: string) {
    await fetch(`/api/memory-blocks/${id}`, { method: 'DELETE' })
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    if (selectedId === id) closePanel()
  }

  const filtered = blocks.filter((b) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase())
  )

  const selected = selectedId && selectedId !== 'new'
    ? blocks.find((b) => b.id === selectedId) ?? null
    : null

  return (
    <>
    <div className="flex h-full bg-white dark:bg-[#111b21]">
      {/* Left panel — block list */}
      <div className="w-80 shrink-0 flex flex-col border-r border-[#f0f2f5] dark:border-[#2a3942]">
        {/* Header */}
        <div className="px-5 pt-6 pb-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain size={18} className="text-[#00a884]" />
              <span className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Memória do Agente</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAnalyzeOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942] hover:bg-[#e9edef] dark:hover:bg-[#3d4f5a] text-[#667781] dark:text-[#aebac1] text-xs font-semibold transition-colors"
              >
                <Sparkles size={13} />
                Analisar
              </button>
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008a6c] text-white text-xs font-semibold transition-colors"
              >
                <Plus size={13} />
                Novo
              </button>
            </div>
          </div>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#aebac1]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar bloco..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent rounded-xl outline-none focus:border-[#00a884] transition-colors text-[#111b21] dark:text-[#e9edef] placeholder:text-[#aebac1]"
            />
          </div>
        </div>

        {/* Legend */}
        <div className="px-5 py-3 flex items-center gap-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 uppercase tracking-wide">Core</span>
            <span className="text-xs text-[#aebac1]">sempre ativo</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 uppercase tracking-wide">Contextual</span>
            <span className="text-xs text-[#aebac1]">por keyword</span>
          </div>
        </div>

        {/* Block list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-sm text-[#aebac1]">Carregando...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 px-5 text-center">
              <Brain size={28} className="text-[#d1d7db] dark:text-[#3d4f5a]" />
              <p className="text-sm text-[#aebac1] dark:text-[#667781] leading-relaxed">
                {search ? 'Nenhum bloco encontrado.' : 'Nenhum bloco de memória ainda. Crie o primeiro!'}
              </p>
            </div>
          ) : (
            filtered.map((block) => (
              <button
                key={block.id}
                onClick={() => openEdit(block)}
                className={[
                  'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors border-b border-[#f0f2f5] dark:border-[#2a3942]',
                  selectedId === block.id
                    ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                    : 'hover:bg-[#f0f2f5] dark:hover:bg-[#182229]',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] truncate">
                      {block.name}
                    </span>
                    <TypeBadge type={block.type} />
                  </div>
                  <p className="text-xs text-[#aebac1] dark:text-[#667781] truncate">
                    {block.content.slice(0, 60)}{block.content.length > 60 ? '…' : ''}
                  </p>
                  {block.type === 'contextual' && block.keywords.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <Tag size={9} className="text-amber-500 shrink-0" />
                      <span className="text-[9px] text-[#aebac1]">{block.keywords.slice(0, 3).join(', ')}{block.keywords.length > 3 ? '…' : ''}</span>
                    </div>
                  )}
                </div>
                <ChevronRight size={14} className="text-[#aebac1] shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — editor */}
      {selectedId ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
            <span className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">
              {selectedId === 'new' ? 'Novo bloco de memória' : (selected?.name ?? 'Editar bloco')}
            </span>
            <div className="flex items-center gap-2">
              {selectedId !== 'new' && selected && (
                <button
                  onClick={() => deleteBlock(selected.id)}
                  className="p-2 rounded-lg text-[#aebac1] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="Excluir bloco"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                onClick={closePanel}
                className="p-2 rounded-lg text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Name */}
            <div>
              <label className={labelClass}>Nome do bloco</label>
              <input
                type="text"
                value={form.name ?? ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ex: Identidade da empresa, Tabela de preços..."
                className={inputClass}
              />
            </div>

            {/* Type */}
            <div>
              <label className={labelClass}>Tipo</label>
              <div className="grid grid-cols-2 gap-2">
                {(['always', 'contextual'] as MemoryBlockType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, type: t })}
                    className={[
                      'flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-colors',
                      form.type === t
                        ? t === 'always'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-[#d1d7db] dark:border-[#3d4f5a] hover:border-[#00a884]',
                    ].join(' ')}
                  >
                    <TypeBadge type={t} />
                    <span className="text-xs text-[#667781] dark:text-[#aebac1] leading-snug mt-0.5">
                      {t === 'always'
                        ? 'Sempre incluído no prompt'
                        : 'Incluído apenas quando keywords aparecem na mensagem'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Keywords (only for contextual) */}
            {form.type === 'contextual' && (
              <div>
                <label className={labelClass}>Keywords de ativação</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                    placeholder="ex: preço, valor, custo"
                    className={inputClass}
                  />
                  <button
                    onClick={addKeyword}
                    className="px-4 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] hover:bg-[#00a884] hover:text-white transition-colors shrink-0"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {(form.keywords ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(form.keywords ?? []).map((kw) => (
                      <span key={kw} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
                        {kw}
                        <button onClick={() => removeKeyword(kw)} className="hover:text-red-500 transition-colors">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-2 leading-relaxed">
                  Quando qualquer uma dessas palavras aparecer na mensagem do cliente, este bloco será incluído no prompt. Case-insensitive.
                </p>
              </div>
            )}

            {/* Content */}
            <div>
              <label className={labelClass}>Conteúdo</label>
              <textarea
                rows={10}
                value={form.content ?? ''}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Escreva aqui as informações que o agente deve ter acesso..."
                className={inputClass}
              />
              <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-1.5 leading-relaxed">
                {form.type === 'always'
                  ? 'Este conteúdo será sempre injetado no início do prompt do agente.'
                  : 'Este conteúdo só será injetado no prompt quando uma keyword for detectada na mensagem.'}
              </p>
            </div>
          </div>

          {/* Save button */}
          <div className="px-6 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
            <button
              onClick={save}
              disabled={saving || !form.name?.trim() || !form.content?.trim()}
              className="w-full py-3 rounded-xl bg-[#00a884] hover:bg-[#008a6c] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {saving ? 'Salvando...' : selectedId === 'new' ? 'Criar bloco' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <Brain size={40} className="text-[#d1d7db] dark:text-[#3d4f5a]" />
          <div>
            <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] mb-1">Blocos de Memória</p>
            <p className="text-xs text-[#aebac1] dark:text-[#667781] leading-relaxed max-w-xs">
              Crie blocos com informações sobre sua empresa, produtos e serviços. O agente de IA usará essas informações para responder como um atendente informado.
            </p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00a884] hover:bg-[#008a6c] text-white text-sm font-semibold transition-colors"
          >
            <Plus size={15} />
            Criar primeiro bloco
          </button>
        </div>
      )}
    </div>

    {analyzeOpen && (
      <AnalyzeConversationsDialog
        instanceName={instanceName}
        onClose={() => setAnalyzeOpen(false)}
        onBlocksAccepted={() => {
          fetchBlocks()
          setAnalyzeOpen(false)
        }}
      />
    )}
    </>
  )
}

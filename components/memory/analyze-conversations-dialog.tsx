'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Search, Sparkles, ChevronLeft, CheckSquare, Square, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { AnalysisResult, MemoryBlockType, MemorySuggestion } from '@/types'

interface Props {
  instanceName: string
  onClose: () => void
  onBlocksAccepted: () => void
}

interface ConversationOption {
  id: string
  contact_name: string | null
  contact_phone: string
  last_message: string | null
}

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

export default function AnalyzeConversationsDialog({ instanceName, onClose, onBlocksAccepted }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [messagesPerContact, setMessagesPerContact] = useState(20)
  const [conversations, setConversations] = useState<ConversationOption[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [convSearch, setConvSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [userGoal, setUserGoal] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const [rejected, setRejected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/conversations?instance=${encodeURIComponent(instanceName)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        const rows: ConversationOption[] = json.ok
          ? (json.conversations as ConversationOption[]).map((c) => ({
              id: c.id,
              contact_name: c.contact_name,
              contact_phone: c.contact_phone,
              last_message: c.last_message,
            }))
          : []
        setConversations(rows)
        setLoadingConvs(false)
      })
      .catch(() => setLoadingConvs(false))
  }, [instanceName])

  const filteredConvs = useMemo(() => {
    const q = convSearch.toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        c.contact_phone.includes(q)
    )
  }, [conversations, convSearch])

  const tokenEstimate = useMemo(() => {
    const selectedCount = selectedIds.size
    const avgMsgLength = 80
    const effectiveMsgs = messagesPerContact * 0.7
    const convChars = selectedCount * effectiveMsgs * avgMsgLength
    const systemChars = 900
    const total = Math.round((convChars + userGoal.length + systemChars) / 4)
    return { tokens: total, selectedCount }
  }, [selectedIds.size, messagesPerContact, userGoal])

  function tokenColor() {
    if (tokenEstimate.tokens < 30000) return 'text-emerald-600 dark:text-emerald-400'
    if (tokenEstimate.tokens < 80000) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-500 dark:text-red-400'
  }

  function tokenBg() {
    if (tokenEstimate.tokens < 30000) return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
    if (tokenEstimate.tokens < 80000) return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  }

  function tokenLabel() {
    if (tokenEstimate.tokens < 30000) return 'Ótimo — custo baixo'
    if (tokenEstimate.tokens < 80000) return 'Moderado'
    return 'Alto — considere reduzir contatos ou mensagens'
  }

  function toggleContact(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filteredConvs.map((c) => c.id)))
  }

  function clearAll() {
    setSelectedIds(new Set())
  }

  async function runAnalysis() {
    setAnalyzing(true)
    setError(null)
    setResult(null)
    setAccepted(new Set())
    setRejected(new Set())
    setStep(3)

    try {
      const res = await fetch('/api/conversations/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: instanceName,
          conversation_ids: [...selectedIds],
          messages_per_contact: messagesPerContact,
          user_goal: userGoal.trim(),
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setResult(json.result)
      } else {
        setError(json.error ?? 'Erro desconhecido.')
      }
    } catch {
      setError('Erro de rede. Verifique sua conexão e tente novamente.')
    } finally {
      setAnalyzing(false)
    }
  }

  function acceptSuggestion(i: number) {
    setAccepted((prev) => new Set([...prev, i]))
    setRejected((prev) => { const n = new Set(prev); n.delete(i); return n })
  }

  function rejectSuggestion(i: number) {
    setRejected((prev) => new Set([...prev, i]))
    setAccepted((prev) => { const n = new Set(prev); n.delete(i); return n })
  }

  function acceptAll() {
    if (!result) return
    setAccepted(new Set(result.suggestions.map((_, i) => i)))
    setRejected(new Set())
  }

  async function saveAccepted() {
    if (!result || accepted.size === 0) return
    setSaving(true)
    const toSave = [...accepted].map((i) => result.suggestions[i])
    await Promise.all(
      toSave.map((s: MemorySuggestion) =>
        fetch('/api/memory-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_name: instanceName,
            name: s.name,
            content: s.content,
            type: s.type,
            keywords: s.keywords ?? [],
          }),
        })
      )
    )
    setSaving(false)
    onBlocksAccepted()
  }

  const selectedCount = selectedIds.size
  const warningColor =
    selectedCount > 20
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-[#233138] rounded-xl shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        {/* ── Step 1: Select Contacts ───────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#00a884]" />
                <span className="font-semibold text-[#111b21] dark:text-[#e9edef] text-sm">Analisar Conversas</span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 pt-4 pb-2 space-y-4">
              {/* Messages per contact */}
              <div>
                <label className="text-xs font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide block mb-1.5">
                  Mensagens por contato
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={messagesPerContact}
                    onChange={(e) => setMessagesPerContact(Math.min(50, Math.max(1, Number(e.target.value))))}
                    className="w-24 text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-3 py-2 outline-none focus:border-[#00a884] transition-colors"
                  />
                  <span className="text-xs text-[#8696a0]">máx. 50 mensagens por contato</span>
                </div>
              </div>

              {/* Warning */}
              {selectedCount > 10 && (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${warningColor}`}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {selectedCount > 20
                      ? `${selectedCount} contatos selecionados. Considere reduzir para melhor qualidade e menor custo.`
                      : `${selectedCount} contatos selecionados. A análise pode demorar mais.`}
                  </span>
                </div>
              )}

              {/* Search + select all/clear */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#aebac1]" />
                  <input
                    type="text"
                    value={convSearch}
                    onChange={(e) => setConvSearch(e.target.value)}
                    placeholder="Buscar contato..."
                    className="w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg pl-8 pr-3 py-2 outline-none focus:border-[#00a884] transition-colors placeholder:text-[#aebac1]"
                  />
                </div>
                <button
                  onClick={selectAll}
                  className="text-xs text-[#00a884] hover:text-[#008a6c] font-medium transition-colors whitespace-nowrap"
                >
                  Todos
                </button>
                <button
                  onClick={clearAll}
                  className="text-xs text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] font-medium transition-colors"
                >
                  Limpar
                </button>
              </div>
            </div>

            {/* Contact list */}
            <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0 max-h-60">
              {loadingConvs ? (
                <div className="flex items-center justify-center h-20 text-xs text-[#8696a0]">
                  <Loader2 size={16} className="animate-spin mr-2" /> Carregando contatos...
                </div>
              ) : filteredConvs.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-xs text-[#8696a0]">
                  Nenhuma conversa encontrada.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredConvs.map((conv) => {
                    const isSelected = selectedIds.has(conv.id)
                    const name = conv.contact_name || conv.contact_phone
                    return (
                      <button
                        key={conv.id}
                        onClick={() => toggleContact(conv.id)}
                        className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-[#e7f8f4] dark:bg-[#00a884]/10'
                            : 'hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                        }`}
                      >
                        {isSelected ? (
                          <CheckSquare size={14} className="shrink-0 text-[#00a884]" />
                        ) : (
                          <Square size={14} className="shrink-0 text-[#aebac1]" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate">{name}</p>
                          {conv.last_message && (
                            <p className="text-[11px] text-[#8696a0] truncate">{conv.last_message}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] flex items-center justify-between">
              <span className="text-xs text-[#8696a0]">
                {selectedCount > 0 ? `${selectedCount} selecionado${selectedCount > 1 ? 's' : ''}` : 'Nenhum selecionado'}
              </span>
              <button
                onClick={() => setStep(2)}
                disabled={selectedCount === 0}
                className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008a6c] text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Próximo
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: User Goal + Token Estimate ───────────────────────── */}
        {step === 2 && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="font-semibold text-[#111b21] dark:text-[#e9edef] text-sm">Configurar Análise</span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 flex-1">
              <div>
                <label className="text-xs font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide block mb-1.5">
                  Objetivo da análise
                </label>
                <textarea
                  value={userGoal}
                  onChange={(e) => setUserGoal(e.target.value)}
                  rows={4}
                  placeholder="ex: gere uma personalidade de atendente ideal para esse tipo de venda, focando em objeções comuns sobre preço"
                  className="w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-4 py-3 outline-none focus:border-[#00a884] transition-colors resize-none placeholder:text-[#aebac1] dark:placeholder:text-[#667781]"
                />
              </div>

              {/* Token estimate */}
              <div className={`rounded-lg border px-4 py-3 space-y-1 ${tokenBg()}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide">
                    Estimativa de tokens
                  </span>
                  <span className={`text-sm font-bold ${tokenColor()}`}>
                    ~{tokenEstimate.tokens.toLocaleString('pt-BR')}
                  </span>
                </div>
                <p className="text-[11px] text-[#8696a0]">
                  {tokenEstimate.selectedCount} contato{tokenEstimate.selectedCount !== 1 ? 's' : ''} × ~{messagesPerContact} mensagens ≈ {tokenEstimate.tokens.toLocaleString('pt-BR')} tokens
                </p>
                <p className={`text-[11px] font-medium ${tokenColor()}`}>{tokenLabel()}</p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] flex justify-end">
              <button
                onClick={runAnalysis}
                disabled={!userGoal.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008a6c] text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={13} />
                Analisar
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Results ───────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
              <span className="font-semibold text-[#111b21] dark:text-[#e9edef] text-sm">Resultado da Análise</span>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
              {/* Loading */}
              {analyzing && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 size={28} className="animate-spin text-[#00a884]" />
                  <p className="text-sm text-[#667781] dark:text-[#8696a0]">Analisando conversas...</p>
                  <p className="text-xs text-[#aebac1]">Isso pode levar alguns segundos</p>
                </div>
              )}

              {/* Error */}
              {!analyzing && error && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 px-3 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <p className="text-xs">{error}</p>
                  </div>
                  <button
                    onClick={() => { setStep(2); setError(null) }}
                    className="text-xs text-[#00a884] hover:text-[#008a6c] font-medium transition-colors"
                  >
                    ← Tentar novamente
                  </button>
                </div>
              )}

              {/* Result */}
              {!analyzing && result && (
                <>
                  {/* Analysis text */}
                  <div className="bg-[#f0f2f5] dark:bg-[#182229] rounded-lg px-4 py-3">
                    <p className="text-xs font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide mb-2">Análise</p>
                    <p className="text-xs text-[#111b21] dark:text-[#e9edef] leading-relaxed whitespace-pre-wrap">{result.analysis}</p>
                  </div>

                  {/* Suggestions */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide">
                          Sugestões
                        </p>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781]">
                          {result.suggestions.length}
                        </span>
                      </div>
                      <button
                        onClick={acceptAll}
                        className="text-xs text-[#00a884] hover:text-[#008a6c] font-medium transition-colors"
                      >
                        Aceitar todas
                      </button>
                    </div>

                    <div className="space-y-2">
                      {result.suggestions.map((s, i) => {
                        const isAccepted = accepted.has(i)
                        const isRejected = rejected.has(i)
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border px-3 py-3 transition-colors ${
                              isAccepted
                                ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10'
                                : isRejected
                                ? 'border-[#d1d7db] dark:border-[#2a3942] opacity-50'
                                : 'border-[#d1d7db] dark:border-[#2a3942]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">{s.name}</span>
                                <TypeBadge type={s.type} />
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => acceptSuggestion(i)}
                                  title="Aceitar"
                                  className={`p-1 rounded-full transition-colors ${
                                    isAccepted
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-[#aebac1] hover:text-emerald-600 dark:hover:text-emerald-400'
                                  }`}
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                                <button
                                  onClick={() => rejectSuggestion(i)}
                                  title="Rejeitar"
                                  className={`p-1 rounded-full transition-colors ${
                                    isRejected
                                      ? 'text-red-500 dark:text-red-400'
                                      : 'text-[#aebac1] hover:text-red-500 dark:hover:text-red-400'
                                  }`}
                                >
                                  <XCircle size={15} />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] leading-relaxed">{s.content}</p>
                            {s.type === 'contextual' && s.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {s.keywords.map((kw) => (
                                  <span
                                    key={kw}
                                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] dark:text-[#8696a0]"
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {!analyzing && result && (
              <div className="px-5 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] flex items-center justify-between">
                <span className="text-xs text-[#8696a0]">
                  {accepted.size > 0
                    ? `${accepted.size} bloco${accepted.size > 1 ? 's' : ''} aceito${accepted.size > 1 ? 's' : ''}`
                    : 'Nenhum aceito ainda'}
                </span>
                <button
                  onClick={saveAccepted}
                  disabled={accepted.size === 0 || saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008a6c] text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                  {saving ? 'Salvando...' : `Salvar Aceitos${accepted.size > 0 ? ` (${accepted.size})` : ''}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

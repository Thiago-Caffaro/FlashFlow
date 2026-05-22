'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BellOff, Bot, CheckSquare,
  MessageSquare, Search, Square, X, Zap,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AISessionWithContext, Conversation } from '@/types'
import ConversationItem from '@/components/chat/conversation-item'
import ChatWindow from '@/components/chat/chat-window'
import SessionChatView from '@/components/ai-sessions/session-chat-view'
import TerminateSessionDialog from '@/components/ai-sessions/terminate-session-dialog'
import AccountDropdown from '@/components/chat/account-dropdown'

// ─── Types ──────────────────────────────────────────────────────────────────

type ChatFilter = 'principal' | 'all' | 'escalated' | 'ai'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStoredFilter(): ChatFilter {
  if (typeof window === 'undefined') return 'principal'
  const v = localStorage.getItem('chatsFilter') as ChatFilter | null
  return v ?? 'principal'
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

// ─── SessionItem ─────────────────────────────────────────────────────────────

interface SessionItemProps {
  item: AISessionWithContext
  index: number
  isActive: boolean
  isSelected: boolean
  selectionActive: boolean
  onItemClick: (e: React.MouseEvent, item: AISessionWithContext, index: number) => void
  onTerminate: () => void
}

function SessionItem({ item, index, isActive, isSelected, selectionActive, onItemClick, onTerminate }: SessionItemProps) {
  const { session, conversation, flow_name } = item
  const [imgError, setImgError] = useState(false)
  const displayName = conversation.contact_name || conversation.contact_phone
  const canHavePic = !conversation.wa_id.endsWith('@lid')
  const proxyUrl = canHavePic
    ? `/api/profile-picture/proxy?waId=${encodeURIComponent(conversation.wa_id)}&instance=${encodeURIComponent(conversation.instance_name)}`
    : null

  return (
    <div
      onClick={(e) => onItemClick(e, item, index)}
      className={[
        'group relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#f0f2f5] dark:border-[#1f2c34] select-none',
        isSelected
          ? 'bg-[#e7f8f4] dark:bg-[#00a884]/10'
          : isActive
          ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
          : 'hover:bg-[#f5f6f6] dark:hover:bg-[#182229]',
      ].join(' ')}
    >
      <div
        className={`shrink-0 transition-opacity ${isSelected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ width: 16 }}
      >
        {isSelected
          ? <CheckSquare size={15} className="text-[#00a884]" />
          : <Square size={15} className="text-[#aebac1]" />}
      </div>

      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-[#dfe5e7] dark:bg-[#2a3942] flex items-center justify-center text-sm font-semibold text-[#54656f] dark:text-[#8696a0] overflow-hidden select-none">
          {proxyUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxyUrl} alt={displayName} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          ) : (
            getInitials(displayName)
          )}
        </div>
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#00a884] rounded-full border-2 border-white dark:border-[#111b21] animate-pulse" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {session.requires_human && (
              <span title="Requer atendimento humano" className="shrink-0">
                <AlertTriangle size={12} className="text-amber-500" />
              </span>
            )}
            <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef] truncate">{displayName}</p>
          </div>
          <span className="text-[10px] text-[#667781] dark:text-[#8696a0] shrink-0">
            {formatRelativeTime(session.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="text-xs truncate">
            {flow_name
              ? <span className="text-[#00a884]">{flow_name}</span>
              : <span className="italic text-[#667781] dark:text-[#8696a0]">fluxo desconhecido</span>}
          </p>
          <span className="text-[10px] text-[#667781] dark:text-[#8696a0] shrink-0">
            {session.max_messages ? `${session.message_count}/${session.max_messages} msgs` : `${session.message_count} msgs`}
          </span>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onTerminate() }}
        title="Encerrar sessão"
        className="shrink-0 p-1.5 rounded-full text-[#aebac1] dark:text-[#667781] hover:bg-[#fee2e2] hover:text-[#ef4444] dark:hover:bg-[#2a1c1c] dark:hover:text-[#ef4444] transition-colors opacity-0 group-hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  )
}

// ─── Filter config ────────────────────────────────────────────────────────────

const FILTERS: { value: ChatFilter; label: string; Icon?: React.ElementType }[] = [
  { value: 'principal', label: 'Principal', Icon: MessageSquare },
  { value: 'all',       label: 'Todos' },
  { value: 'escalated', label: 'Escalados', Icon: AlertTriangle },
  { value: 'ai',        label: 'Com IA',    Icon: Zap },
]

// ─── ChatsTab ────────────────────────────────────────────────────────────────

interface ChatsTabProps {
  instanceName: string
}

export default function ChatsTab({ instanceName }: ChatsTabProps) {
  const [filter, setFilter] = useState<ChatFilter>(getStoredFilter)
  const [isConnecting, setIsConnecting] = useState(false)

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [convLoading, setConvLoading] = useState(true)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Sessions
  const [sessions, setSessions] = useState<AISessionWithContext[]>([])
  const [sessLoading, setSessLoading] = useState(true)
  const [selectedSessId, setSelectedSessId] = useState<string | null>(null)
  const [terminatingSession, setTerminatingSession] = useState<AISessionWithContext | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)

  const convTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Persist filter
  useEffect(() => { localStorage.setItem('chatsFilter', filter) }, [filter])

  // ── Fetch conversations ────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('instance_name', instanceName)
      .order('last_message_at', { ascending: false })

    const seen = new Set<string>()
    const unique = (data ?? []).filter((c) => {
      if (seen.has(c.wa_id)) return false
      seen.add(c.wa_id)
      return true
    })
    setConversations(unique)
    setConvLoading(false)
  }, [instanceName])

  // ── Fetch sessions ─────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/ai-sessions?instance=${encodeURIComponent(instanceName)}`)
    const json = await res.json()
    if (json.ok) {
      const next = json.sessions as AISessionWithContext[]
      setSessions(next)
      setSelectedSessId((prev) => (prev && next.some((s) => s.session.id === prev) ? prev : null))
      setSelectedIds((prev) => {
        const nextIds = new Set(next.map((s) => s.session.id))
        const kept = new Set([...prev].filter((id) => nextIds.has(id)))
        return kept.size === prev.size ? prev : kept
      })
    }
    setSessLoading(false)
  }, [instanceName])

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    setConvLoading(true)
    setSessLoading(true)
    setSelectedConvId(null)
    setSelectedSessId(null)
    fetchConversations()
    loadSessions()
  }, [instanceName]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime + polling: conversations ──────────────────────────────────────

  useEffect(() => {
    const ch = supabase
      .channel(`chats_conv:${instanceName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (payload) => {
        const rec = (payload.new ?? payload.old ?? {}) as Record<string, string>
        if (rec.instance_name && rec.instance_name !== instanceName) return
        if (convTimerRef.current) clearTimeout(convTimerRef.current)
        convTimerRef.current = setTimeout(() => fetchConversations(), 300)
      })
      .subscribe()

    const poll = setInterval(() => fetchConversations(), 15000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
      if (convTimerRef.current) clearTimeout(convTimerRef.current)
    }
  }, [instanceName, fetchConversations])

  // ── Realtime + polling: sessions ───────────────────────────────────────────

  useEffect(() => {
    const ch = supabase
      .channel(`chats_sess:${instanceName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_sessions' }, (payload) => {
        const rec = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
        if (rec.instance_name && rec.instance_name !== instanceName) return
        if (sessTimerRef.current) clearTimeout(sessTimerRef.current)
        sessTimerRef.current = setTimeout(() => loadSessions(), 300)
      })
      .subscribe()

    const poll = setInterval(() => loadSessions(), 15000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
      if (sessTimerRef.current) clearTimeout(sessTimerRef.current)
    }
  }, [instanceName, loadSessions])

  // ── Derived data ───────────────────────────────────────────────────────────

  const sortedSessions = useMemo(() => (
    [...sessions].sort((a, b) => {
      if (a.session.requires_human === b.session.requires_human) {
        const ta = a.session.last_message_at ? new Date(a.session.last_message_at).getTime() : 0
        const tb = b.session.last_message_at ? new Date(b.session.last_message_at).getTime() : 0
        return tb - ta
      }
      return a.session.requires_human ? -1 : 1
    })
  ), [sessions])

  const displaySessions = useMemo(() => (
    sortedSessions.filter((s) => {
      if (filter === 'escalated') return s.session.requires_human
      if (filter === 'ai') return !s.session.requires_human
      return true
    })
  ), [sortedSessions, filter])

  const filteredConversations = useMemo(() => (
    query
      ? conversations.filter((c) =>
          (c.contact_name ?? c.contact_phone).toLowerCase().includes(query.toLowerCase())
        )
      : conversations
  ), [conversations, query])

  const selectedConversation = conversations.find((c) => c.id === selectedConvId) ?? null
  const selectedSession = sessions.find((s) => s.session.id === selectedSessId) ?? null
  const isPrincipal = filter === 'principal'
  const selectionActive = selectedIds.size > 0
  const hasEscalations = sessions.some((s) => s.session.requires_human)

  // ── Session handlers ───────────────────────────────────────────────────────

  function handleSessionClick(e: React.MouseEvent, item: AISessionWithContext, index: number) {
    if (e.shiftKey) {
      e.preventDefault()
      if (anchorIndex === null) {
        setSelectedIds(new Set([item.session.id]))
        setAnchorIndex(index)
      } else {
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        setSelectedIds(new Set(displaySessions.slice(start, end + 1).map((s) => s.session.id)))
      }
      return
    }
    setSelectedIds(new Set())
    setAnchorIndex(null)
    setSelectedSessId(item.session.id)
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setAnchorIndex(null)
  }

  async function handleTerminate(id: string, message: string, useFlowMessage: boolean) {
    await fetch(`/api/ai-sessions/${id}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, useFlowMessage }),
    })
    setTerminatingSession(null)
    await loadSessions()
  }

  async function handleBulkTerminate() {
    await Promise.all(
      [...selectedIds].map((id) =>
        fetch(`/api/ai-sessions/${id}/terminate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '', useFlowMessage: false }),
        })
      )
    )
    clearSelection()
    await loadSessions()
  }

  async function handleClearEscalations() {
    await fetch('/api/ai-sessions/clear-escalations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: instanceName }),
    })
    await loadSessions()
  }

  // ── Subtitle ───────────────────────────────────────────────────────────────

  const subtitle = (() => {
    if (isPrincipal) {
      if (convLoading) return 'Carregando...'
      const n = filteredConversations.length
      return `${n} ${n === 1 ? 'conversa' : 'conversas'}`
    }
    if (sessLoading) return 'Carregando...'
    const n = displaySessions.length
    if (n === 0) return 'Nenhuma sessão ativa'
    return `${n} ${n === 1 ? 'sessão ativa' : 'sessões ativas'}`
  })()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full w-full bg-white dark:bg-[#111b21]">

      {/* ── Left sidebar ── */}
      <div
        className="flex flex-col h-full border-r border-[#d1d7db] dark:border-[#2a3942] shrink-0"
        style={{ width: 360, minWidth: 280 }}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#d1d7db] dark:border-[#2a3942] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Chats</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">{subtitle}</p>
            </div>
            <AccountDropdown onConnectingChange={setIsConnecting} />
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5">
            {FILTERS.map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={[
                  'flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 select-none',
                  filter === value
                    ? 'bg-[#00a884] text-white shadow-sm'
                    : 'bg-[#f0f2f5] dark:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#3d4f5a] hover:text-[#111b21] dark:hover:text-[#e9edef]',
                ].join(' ')}
              >
                {Icon && <Icon size={10} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk selection toolbar (AI sessions) */}
        {!isPrincipal && selectionActive && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#e7f8f4] dark:bg-[#00a884]/10 border-b border-[#00a884]/20 shrink-0">
            <span className="text-xs font-medium text-[#00a884]">
              {selectedIds.size} {selectedIds.size === 1 ? 'selecionado' : 'selecionados'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleBulkTerminate}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-white font-medium transition-colors"
              >
                Encerrar
              </button>
              <button
                onClick={clearSelection}
                className="p-1 rounded-full text-[#667781] hover:bg-[#d1d7db]/40 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Search (Principal only) */}
        {isPrincipal && (
          <div className="px-3 py-2 shrink-0">
            <div className="flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg px-3 py-2">
              <Search size={16} className="text-[#54656f] dark:text-[#aebac1] shrink-0" />
              <input
                type="text"
                placeholder="Pesquisar conversa"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent text-sm text-[#111b21] dark:text-[#e9edef] placeholder:text-[#667781] dark:placeholder:text-[#8696a0] outline-none flex-1 min-w-0"
              />
            </div>
          </div>
        )}

        {/* List */}
        <div className="relative flex-1 overflow-y-auto">
          {isConnecting && (
            <div className="absolute inset-0 z-10 bg-white/60 dark:bg-[#111b21]/60 cursor-not-allowed" />
          )}

          {isPrincipal ? (
            convLoading ? (
              <div className="flex items-center justify-center h-20 text-[#667781] dark:text-[#8696a0] text-sm">Carregando...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-[#667781] dark:text-[#8696a0] text-sm">
                {query ? 'Nenhum resultado' : 'Nenhuma conversa'}
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={conv.id === selectedConvId}
                  onClick={() => setSelectedConvId(conv.id)}
                />
              ))
            )
          ) : (
            sessLoading ? (
              <div className="flex items-center justify-center h-20 text-[#667781] dark:text-[#8696a0] text-sm">Carregando...</div>
            ) : displaySessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                <Bot size={40} className="text-[#aebac1] dark:text-[#667781]" />
                <p className="text-sm text-[#667781] dark:text-[#8696a0]">
                  {filter === 'all'
                    ? 'Nenhuma sessão de IA ativa no momento.'
                    : filter === 'escalated'
                    ? 'Nenhuma sessão escalada.'
                    : 'Nenhuma sessão em atendimento pela IA.'}
                </p>
              </div>
            ) : (
              displaySessions.map((item, index) => (
                <SessionItem
                  key={item.session.id}
                  item={item}
                  index={index}
                  isActive={selectedSessId === item.session.id}
                  isSelected={selectedIds.has(item.session.id)}
                  selectionActive={selectionActive}
                  onItemClick={handleSessionClick}
                  onTerminate={() => setTerminatingSession(item)}
                />
              ))
            )
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {isPrincipal ? (
          <ChatWindow conversation={selectedConversation} onMessageSent={() => {}} />
        ) : selectedSession ? (
          <SessionChatView
            key={selectedSession.session.id}
            sessionWithCtx={selectedSession}
            instanceName={instanceName}
            onTerminate={() => setTerminatingSession(selectedSession)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-[#f0f2f5] dark:bg-[#2a3942] flex items-center justify-center">
              <Bot size={28} className="text-[#aebac1] dark:text-[#667781]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#667781] dark:text-[#8696a0]">
                Selecione uma sessão para visualizar o histórico
              </p>
              <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-1">
                As mensagens enviadas pela IA são marcadas com a badge{' '}
                <span className="inline-block bg-[#00a884]/20 text-[#00a884] px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                  IA
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {terminatingSession && (
        <TerminateSessionDialog
          sessionWithCtx={terminatingSession}
          onClose={() => setTerminatingSession(null)}
          onConfirm={handleTerminate}
        />
      )}

      {!isPrincipal && hasEscalations && !selectionActive && (
        <button
          onClick={handleClearEscalations}
          className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium shadow-lg transition-colors z-10"
        >
          <BellOff size={13} />
          Limpar notificações
        </button>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AISessionWithContext } from '@/types'
import SessionList from './session-list'
import SessionChatView from './session-chat-view'
import TerminateSessionDialog from './terminate-session-dialog'
import { BellOff } from 'lucide-react'

type Filter = 'all' | 'escalated' | 'ai'

interface AiSessionsTabProps {
  instanceName: string
}

export default function AiSessionsTab({ instanceName }: AiSessionsTabProps) {
  const [sessions, setSessions] = useState<AISessionWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [terminatingSession, setTerminatingSession] = useState<AISessionWithContext | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/ai-sessions?instance=${encodeURIComponent(instanceName)}`)
    const json = await res.json()
    if (json.ok) {
      const next = json.sessions as AISessionWithContext[]
      setSessions(next)
      setSelectedId((prev) => (prev && next.some((s) => s.session.id === prev) ? prev : null))
      // Remove selected IDs that no longer exist
      setSelectedIds((prev) => {
        const nextIds = new Set(next.map((s) => s.session.id))
        const kept = new Set([...prev].filter((id) => nextIds.has(id)))
        return kept.size === prev.size ? prev : kept
      })
    }
    setLoading(false)
  }, [instanceName])

  useEffect(() => {
    setLoading(true)
    loadSessions()
  }, [instanceName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const channel = supabase
      .channel(`ai_sessions_tab:${instanceName}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_sessions' },
        (payload) => {
          const record = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
          if (record.instance_name && record.instance_name !== instanceName) return
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => loadSessions(), 300)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [instanceName, loadSessions])

  useEffect(() => {
    const interval = setInterval(() => loadSessions(), 15000)
    return () => clearInterval(interval)
  }, [loadSessions])

  // Escalados primeiro, depois mais recentes
  const sortedSessions = useMemo(() => (
    [...sessions].sort((a, b) => {
      if (a.session.requires_human === b.session.requires_human) {
        const aTime = a.session.last_message_at ? new Date(a.session.last_message_at).getTime() : 0
        const bTime = b.session.last_message_at ? new Date(b.session.last_message_at).getTime() : 0
        return bTime - aTime
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

  function handleItemClick(e: React.MouseEvent, item: AISessionWithContext, index: number) {
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
    // Click normal: abre chat, limpa seleção
    setSelectedIds(new Set())
    setAnchorIndex(null)
    setSelectedId(item.session.id)
  }

  function handleClearSelection() {
    setSelectedIds(new Set())
    setAnchorIndex(null)
  }

  async function handleClearEscalations() {
    await fetch('/api/ai-sessions/clear-escalations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: instanceName }),
    })
    await loadSessions()
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
    handleClearSelection()
    await loadSessions()
  }

  const selectedSession = sessions.find((s) => s.session.id === selectedId) ?? null
  const hasEscalations = sessions.some((s) => s.session.requires_human)

  return (
    <div className="relative flex h-full w-full bg-white dark:bg-[#111b21]">
      <SessionList
        sessions={displaySessions}
        loading={loading}
        selectedId={selectedId}
        filter={filter}
        onFilterChange={setFilter}
        selectedIds={selectedIds}
        onItemClick={handleItemClick}
        onTerminate={setTerminatingSession}
        onBulkTerminate={handleBulkTerminate}
        onClearSelection={handleClearSelection}
      />

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selectedSession ? (
          <SessionChatView
            key={selectedSession.session.id}
            sessionWithCtx={selectedSession}
            instanceName={instanceName}
            onTerminate={() => setTerminatingSession(selectedSession)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-[#f0f2f5] dark:bg-[#2a3942] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#aebac1] dark:text-[#667781]">
                <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
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

      {terminatingSession && (
        <TerminateSessionDialog
          sessionWithCtx={terminatingSession}
          onClose={() => setTerminatingSession(null)}
          onConfirm={handleTerminate}
        />
      )}

      {hasEscalations && selectedIds.size === 0 && (
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

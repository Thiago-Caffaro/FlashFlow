'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AISessionWithContext } from '@/types'
import SessionList from './session-list'
import SessionChatView from './session-chat-view'
import TerminateSessionDialog from './terminate-session-dialog'
import { Bot } from 'lucide-react'

interface AiSessionsTabProps {
  instanceName: string
}

export default function AiSessionsTab({ instanceName }: AiSessionsTabProps) {
  const [sessions, setSessions] = useState<AISessionWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [terminatingSession, setTerminatingSession] = useState<AISessionWithContext | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/ai-sessions?instance=${encodeURIComponent(instanceName)}`)
    const json = await res.json()
    if (json.ok) {
      const next = json.sessions as AISessionWithContext[]
      setSessions(next)
      setSelectedId((prev) => (prev && next.some((s) => s.session.id === prev) ? prev : null))
    }
    setLoading(false)
  }, [instanceName])

  useEffect(() => {
    setLoading(true)
    loadSessions()
  }, [instanceName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: sem filtro server-side para evitar falha em UPDATE com replica identity DEFAULT.
  // Filtramos instance_name no client, igual ao padrão de page.tsx para conversations.
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

  // Polling a cada 15s como fallback caso o realtime não esteja habilitado para ai_sessions
  useEffect(() => {
    const interval = setInterval(() => loadSessions(), 15000)
    return () => clearInterval(interval)
  }, [loadSessions])

  async function handleTerminate(id: string, message: string, useFlowMessage: boolean) {
    await fetch(`/api/ai-sessions/${id}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, useFlowMessage }),
    })
    setTerminatingSession(null)
    await loadSessions()
  }

  const selectedSession = sessions.find((s) => s.session.id === selectedId) ?? null

  return (
    <div className="flex h-full w-full bg-white dark:bg-[#111b21]">
      <SessionList
        sessions={sessions}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onTerminate={setTerminatingSession}
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
            <Bot size={48} className="text-[#aebac1] dark:text-[#667781]" />
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
    </div>
  )
}

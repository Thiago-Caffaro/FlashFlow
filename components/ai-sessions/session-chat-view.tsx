'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AISessionWithContext, Message } from '@/types'
import MessageBubble from '@/components/chat/message-bubble'

interface SessionChatViewProps {
  sessionWithCtx: AISessionWithContext
  instanceName: string
  onTerminate: () => void
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function groupByDate(messages: Message[]): { label: string; messages: Message[] }[] {
  const groups: { label: string; messages: Message[] }[] = []
  for (const msg of messages) {
    const label = formatDate(msg.created_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.messages.push(msg)
    } else {
      groups.push({ label, messages: [msg] })
    }
  }
  return groups
}

export default function SessionChatView({ sessionWithCtx, instanceName, onTerminate }: SessionChatViewProps) {
  const { session, conversation, flow_name } = sessionWithCtx
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const displayName = conversation.contact_name || conversation.contact_phone

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
    setMessages(data ?? [])
    setLoading(false)
  }, [conversation.id])

  useEffect(() => {
    setLoading(true)
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    const channel = supabase
      .channel(`session-messages:${conversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message])
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversation.id])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const groups = groupByDate(messages)

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#d1d7db] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33] shrink-0">
        <div className="w-9 h-9 rounded-full bg-[#dfe5e7] dark:bg-[#2a3942] flex items-center justify-center shrink-0">
          <Bot size={18} className="text-[#00a884]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] truncate">{displayName}</p>
          {flow_name && (
            <p className="text-xs text-[#00a884] truncate">{flow_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-[#667781] dark:text-[#8696a0]">
            <span className="w-2 h-2 rounded-full bg-[#00a884] animate-pulse inline-block" />
            IA ativa
          </span>
          <span className="text-[#d1d7db] dark:text-[#2a3942]">|</span>
          <button
            onClick={onTerminate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#ef4444] border border-[#ef4444]/30 hover:bg-[#fee2e2] dark:hover:bg-[#2a1c1c] transition-colors"
          >
            <XCircle size={14} />
            Encerrar sessão
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto min-h-0 px-4 md:px-20 py-4"
        style={{ backgroundColor: 'var(--chat-bg)' }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">Carregando mensagens...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">Nenhuma mensagem ainda.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              {/* Date label */}
              <div className="flex items-center justify-center my-3">
                <span className="px-3 py-1 rounded-full text-[11px] text-[#54656f] dark:text-[#8696a0] bg-[#e1f3fb] dark:bg-[#182229] shadow-sm select-none">
                  {group.label}
                </span>
              </div>
              {group.messages.map((msg) => (
                <div key={msg.id}>
                  {msg.direction === 'outbound' && (
                    <div className="flex justify-end pr-1 mb-0.5">
                      <span className="text-[10px] bg-[#00a884]/20 text-[#00a884] px-1.5 py-0.5 rounded-full font-medium">
                        IA
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    waId={conversation.wa_id}
                    instanceName={instanceName}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 border-t border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#202c33] shrink-0">
        <p className="text-xs text-[#667781] dark:text-[#8696a0] text-center">
          {session.max_messages
            ? `${session.message_count} de ${session.max_messages} mensagens usadas`
            : `${session.message_count} mensagem${session.message_count !== 1 ? 's' : ''} na sessão`}
          {session.expires_at && (
            <> · Expira em {new Date(session.expires_at).toLocaleDateString('pt-BR')}</>
          )}
        </p>
      </div>
    </div>
  )
}

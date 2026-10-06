'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, XCircle, User } from 'lucide-react'
import { AISessionWithContext, Message } from '@/types'
import { mergeFetchedMessages, RECENT_MESSAGES_POLL_LIMIT } from '@/lib/chat-message-merge'
import MessageBubble from '@/components/chat/message-bubble'
import MessageInput from '@/components/chat/message-input'

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
  const [sending, setSending] = useState(false)
  const [operatorName, setOperatorName] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('flashflow_operator_name') ?? '') : ''
  )
  const [showNameDrawer, setShowNameDrawer] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const displayName = conversation.contact_name || conversation.contact_phone

  // recentOnly: polling — só as últimas mensagens, mescladas ao histórico já carregado.
  const loadMessages = useCallback(async (recentOnly = false) => {
    const recentParam = recentOnly ? `&recent=${RECENT_MESSAGES_POLL_LIMIT}` : ''
    const res = await fetch(
      `/api/messages?conversationId=${encodeURIComponent(conversation.id)}&instance=${encodeURIComponent(conversation.instance_name)}${recentParam}`,
      { cache: 'no-store' }
    )
    const json = await res.json()
    if (recentOnly) {
      if (json.ok) setMessages((prev) => mergeFetchedMessages(prev, json.messages, true))
    } else {
      setMessages(json.ok ? json.messages : [])
    }
    setLoading(false)
  }, [conversation.id, conversation.instance_name])

  useEffect(() => {
    setLoading(true)
    loadMessages()
  }, [loadMessages])

  // Sem Realtime via anon key — a tabela "messages" não tem mais leitura
  // anônima (ver P5 da varredura de segurança). Atualização por polling.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMessages(true)
    }, 10000)
    return () => clearInterval(interval)
  }, [loadMessages])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleSend = async (content: string) => {
    const actualContent = operatorName.trim()
      ? `*${operatorName.trim()}*\n${content}`
      : content

    const tempId = `temp-${Date.now()}`
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      wa_message_id: null,
      content: actualContent,
      type: 'text',
      direction: 'outbound',
      status: 'sending',
      sender_type: 'human',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])
    setTimeout(() => {
      const el = messagesContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, 50)

    setSending(true)
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, content: actualContent }),
      })
    } catch (err) {
      console.error('Erro ao enviar:', err)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }

  const handleSendImage = async (file: File) => {
    const tempId = `temp-img-${Date.now()}`
    const localUrl = URL.createObjectURL(file)
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      wa_message_id: null,
      content: localUrl,
      type: 'image',
      direction: 'outbound',
      status: 'sending',
      sender_type: 'human',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])
    setTimeout(() => {
      const el = messagesContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, 50)

    setSending(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('conversationId', conversation.id)
      await fetch('/api/messages/image', { method: 'POST', body: formData })
    } catch (err) {
      console.error('Erro ao enviar imagem:', err)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      URL.revokeObjectURL(localUrl)
      setSending(false)
    }
  }

  const handleReleaseToAI = async () => {
    await fetch(`/api/ai-sessions/${session.id}/release`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_name: session.instance_name }),
    })
  }

  const groups = groupByDate(messages)

  return (
    <div className="relative flex flex-col overflow-hidden h-full">
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
          {session.requires_human && (
            <button
              onClick={handleReleaseToAI}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#00a884] border border-[#00a884]/30 hover:bg-[#00a884]/10 dark:hover:bg-[#00a884]/10 transition-colors"
            >
              <Bot size={14} />
              Devolver à IA
            </button>
          )}
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
              <div className="flex items-center justify-center my-3">
                <span className="px-3 py-1 rounded-full text-[11px] text-[#54656f] dark:text-[#8696a0] bg-[#e1f3fb] dark:bg-[#182229] shadow-sm select-none">
                  {group.label}
                </span>
              </div>
              {group.messages.map((msg) => (
                <div key={msg.id}>
                  {msg.sender_type === 'ai' && (
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

      {/* Operator name drawer */}
      {showNameDrawer && (
        <div className="absolute bottom-[88px] left-0 right-0 bg-white dark:bg-[#202c33] border-t border-[#d1d7db] dark:border-[#2a3942] px-4 py-3 shadow-lg z-20 flex items-center gap-3">
          <User size={16} className="text-[#667781] dark:text-[#8696a0] shrink-0" />
          <input
            type="text"
            value={operatorName}
            onChange={(e) => {
              setOperatorName(e.target.value)
              localStorage.setItem('flashflow_operator_name', e.target.value)
            }}
            placeholder="Nome do atendente (opcional)"
            className="flex-1 text-sm bg-transparent text-[#111b21] dark:text-[#e9edef] placeholder:text-[#667781] dark:placeholder:text-[#8696a0] outline-none"
            autoFocus
          />
          <button
            onClick={() => setShowNameDrawer(false)}
            className="text-xs text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] px-2 py-1 transition-colors"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Input */}
      <MessageInput
        onSend={handleSend}
        onSendImage={handleSendImage}
        disabled={sending}
        leftAction={
          <button
            type="button"
            onClick={() => setShowNameDrawer((v) => !v)}
            title={operatorName ? `Atendente: ${operatorName}` : 'Personalizar atendente'}
            className={`p-2 rounded-full transition-colors shrink-0 ${
              operatorName
                ? 'text-[#00a884] hover:bg-[#00a884]/10'
                : 'text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
            }`}
          >
            <User size={22} />
          </button>
        }
      />

      {/* Session info bar */}
      <div className="px-4 py-1.5 border-t border-[#d1d7db] dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33] shrink-0">
        <p className="text-[10px] text-[#667781] dark:text-[#8696a0] text-center">
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

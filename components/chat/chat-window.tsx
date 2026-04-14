'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { MoreVertical, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Conversation, Message } from '@/types'
import MessageBubble from './message-bubble'
import MessageInput from './message-input'

function getDateLabel(dateStr: string): string {
  const msgDate = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (same(msgDate, today)) return 'Hoje'
  if (same(msgDate, yesterday)) return 'Ontem'

  return msgDate.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function msgDayKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Module-level set persists across remounts for the browser session,
// preventing repeated sync calls for conversations already fetched.
const syncedConversations = new Set<string>()

interface ChatWindowProps {
  conversation: Conversation | null
  onMessageSent: () => void
}

function getInitials(name: string | null, phone: string): string {
  if (name) {
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
  }
  return phone.slice(-2)
}

export default function ChatWindow({ conversation, onMessageSent }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [imgError, setImgError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => setImgError(false), [conversation?.wa_id])

  const conversationId = conversation?.id ?? null

  const fetchMessages = useCallback(async (showLoading = false) => {
    if (!conversationId) return
    if (showLoading) setLoading(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    const msgs = data ?? []
    setMessages(msgs)
    setLoading(false)

    // If we have fewer than 30 messages and haven't synced this conversation
    // yet this session, silently fetch historical messages from Evolution API.
    // New messages will arrive via the Realtime subscription below.
    if (msgs.length < 30 && !syncedConversations.has(conversationId)) {
      syncedConversations.add(conversationId)
      fetch(`/api/messages/sync/${conversationId}`, { method: 'POST' }).catch(() => {})
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    // Show loading indicator only on first load (messages list is empty)
    fetchMessages(true)

    // Marca mensagens como lidas ao abrir a conversa
    fetch(`/api/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {})

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message
          setMessages((prev) => {
            // Deduplicação: se a nova mensagem for 'outbound', removemos mensagens 'sending' idênticas
            if (newMessage.direction === 'outbound') {
              const exists = prev.some(m => m.id === newMessage.id)
              if (exists) return prev

              const filtered = prev.filter(m =>
                !(m.status === 'sending' && m.content === newMessage.content && m.type === newMessage.type)
              )
              return [...filtered, newMessage].sort((a, b) => a.created_at.localeCompare(b.created_at))
            }
            return [...prev, newMessage].sort((a, b) => a.created_at.localeCompare(b.created_at))
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, fetchMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (content: string) => {
    if (!conversation) return
    
    // Optimistic Update
    const tempId = `temp-${Date.now()}`
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      wa_message_id: null,
      content,
      type: 'text',
      direction: 'outbound',
      status: 'sending',
      created_at: new Date().toISOString()
    }
    
    setMessages(prev => [...prev, optimisticMsg])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversation.id,
          waId: conversation.wa_id,
          content,
        }),
      })
      onMessageSent()
    } catch (err) {
      console.error('Erro ao enviar:', err)
      // Marcar como erro ou remover se falhar
      setMessages(prev => prev.filter(m => m.id !== tempId))
    }
  }

  const handleSendImage = async (file: File) => {
    if (!conversation) return
    
    // Optimistic Update for images
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
      created_at: new Date().toISOString()
    }

    setMessages(prev => [...prev, optimisticMsg])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('conversationId', conversation.id)
      formData.append('waId', conversation.wa_id)
      await fetch('/api/messages/image', { method: 'POST', body: formData })
      onMessageSent()
    } catch (err) {
      console.error('Erro ao enviar imagem:', err)
      setMessages(prev => prev.filter(m => m.id !== tempId))
    } finally {
      URL.revokeObjectURL(localUrl)
    }
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] gap-5 select-none">
        <div className="w-24 h-24 rounded-full bg-[#dfe5e7] flex items-center justify-center">
          <svg viewBox="0 0 56 56" width="52" height="52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="28" cy="28" r="24" fill="#aebac1" />
            <path
              d="M28 16c-6.627 0-12 5.373-12 12 0 2.132.558 4.133 1.537 5.868L16 40l6.303-1.524A11.95 11.95 0 0028 40c6.627 0 12-5.373 12-12S34.627 16 28 16z"
              fill="#f0f2f5"
            />
          </svg>
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-[#41525d] text-xl font-light">FlashFlow Web</h2>
          <p className="text-[#667781] text-sm">Selecione uma conversa para começar a trocar mensagens</p>
        </div>
        <div className="mt-2 px-6 py-3 rounded-full border border-[#d1d7db] text-[#667781] text-xs">
          Suas conversas do WhatsApp aparecem aqui
        </div>
      </div>
    )
  }

  const isGroup = conversation.wa_id.endsWith('@g.us')
  const contactName = conversation.contact_name
  const contactPhone = conversation.contact_phone
  const initials = getInitials(contactName, contactPhone)
  // @lid contacts have no resolvable profile picture — skip the proxy request
  const canHavePic = !conversation.wa_id.endsWith('@lid')
  const proxyUrl = canHavePic
    ? `/api/profile-picture/proxy?waId=${encodeURIComponent(conversation.wa_id)}&instance=${encodeURIComponent(conversation.instance_name)}`
    : null

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#f0f2f5] border-b border-[#d1d7db] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#dfe5e7] flex items-center justify-center text-[#667781] font-semibold text-sm select-none overflow-hidden shrink-0">
            {proxyUrl && !imgError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proxyUrl}
                alt={contactName ?? contactPhone}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              initials
            )}
          </div>
          <div>
            {contactName ? (
              <>
                <p className="font-medium text-[#111b21] text-sm leading-tight">{contactName}</p>
                <p className="text-xs text-[#667781]">{contactPhone}</p>
              </>
            ) : (
              <p className="font-medium text-[#111b21] text-sm leading-tight">{contactPhone}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-2 hover:bg-[#e9edef] rounded-full transition-colors text-[#54656f]"
          >
            <Search size={20} />
          </button>
          <button
            type="button"
            className="p-2 hover:bg-[#e9edef] rounded-full transition-colors text-[#54656f]"
          >
            <MoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto px-4 md:px-20 py-4"
        style={{ backgroundColor: '#efeae2' }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[#667781] text-sm">Carregando mensagens...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[#667781] text-sm">Nenhuma mensagem ainda</span>
          </div>
        ) : (
          messages.map((msg, i) => {
              const dayKey = msgDayKey(msg.created_at)
              const prevDayKey = i > 0 ? msgDayKey(messages[i - 1].created_at) : null
              const showSeparator = dayKey !== prevDayKey

              return (
                <div key={msg.id}>
                  {showSeparator && (
                    <div className="flex items-center justify-center my-3">
                      <span className="px-3 py-1 rounded-full text-[11px] text-[#54656f] bg-[#e1f3fb] shadow-sm select-none">
                        {getDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    waId={conversation.wa_id}
                    instanceName={conversation.instance_name}
                    avatarUrl={proxyUrl}
                    initials={initials}
                    isGroup={isGroup}
                  />
                </div>
              )
            })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput onSend={handleSend} onSendImage={handleSendImage} disabled={sending} />
    </div>
  )
}

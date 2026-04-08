'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { MoreVertical, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Conversation, Message } from '@/types'
import MessageBubble from './message-bubble'
import MessageInput from './message-input'

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
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchMessages = useCallback(async () => {
    if (!conversation) return
    setLoading(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
    setMessages(data ?? [])
    setLoading(false)
  }, [conversation])

  useEffect(() => {
    if (!conversation) {
      setMessages([])
      return
    }
    fetchMessages()

    const channel = supabase
      .channel(`messages:${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversation, fetchMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (content: string) => {
    if (!conversation || sending) return
    setSending(true)
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
    } finally {
      setSending(false)
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

  const displayName = conversation.contact_name ?? conversation.contact_phone
  const initials = getInitials(conversation.contact_name, conversation.contact_phone)

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#f0f2f5] border-b border-[#d1d7db] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#dfe5e7] flex items-center justify-center text-[#667781] font-semibold text-sm select-none">
            {initials}
          </div>
          <div>
            <p className="font-medium text-[#111b21] text-sm leading-tight">{displayName}</p>
            <p className="text-xs text-[#667781]">{conversation.contact_phone}</p>
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
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={sending} />
    </div>
  )
}

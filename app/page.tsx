'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Conversation } from '@/types'
import ConversationList from '@/components/chat/conversation-list'
import ChatWindow from '@/components/chat/chat-window'

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false })
    setConversations(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchConversations(true)

    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        // Silent refresh: no loading indicator on realtime updates
        () => fetchConversations(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchConversations])

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f0f2f5]">
      <ConversationList
        conversations={conversations}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <ChatWindow
        conversation={selectedConversation}
        onMessageSent={() => {/* realtime handles conversation list updates */}}
      />
    </div>
  )
}

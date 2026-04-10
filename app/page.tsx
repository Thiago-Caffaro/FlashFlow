'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Conversation } from '@/types'
import ConversationList from '@/components/chat/conversation-list'
import ChatWindow from '@/components/chat/chat-window'
import { AccountProvider, useAccount } from '@/contexts/account-context'

function ChatApp() {
  const { activeAccount } = useAccount()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConversations = useCallback(async (showLoading = false) => {
    if (!activeAccount) {
      setConversations([])
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('instance_name', activeAccount.instanceName)
      .order('last_message_at', { ascending: false })
    setConversations(data ?? [])
    setLoading(false)
  }, [activeAccount])

  // Reset selected conversation when switching accounts
  useEffect(() => {
    setSelectedId(null)
    fetchConversations(true)
  }, [activeAccount?.instanceName, fetchConversations])

  useEffect(() => {
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
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
        onMessageSent={() => {}}
      />
    </div>
  )
}

export default function Home() {
  return (
    <AccountProvider>
      <ChatApp />
    </AccountProvider>
  )
}

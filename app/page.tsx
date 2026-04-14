'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Conversation } from '@/types'
import ConversationList from '@/components/chat/conversation-list'
import ChatWindow from '@/components/chat/chat-window'
import RightSidebar from '@/components/sidebar-right/right-sidebar'
import { AccountProvider, useAccount } from '@/contexts/account-context'

function ChatApp() {
  const { activeAccount } = useAccount()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    // Client-side dedup by wa_id — safety net if DB constraint is missing
    const seen = new Set<string>()
    const unique = (data ?? []).filter((c) => {
      if (seen.has(c.wa_id)) return false
      seen.add(c.wa_id)
      return true
    })
    setConversations(unique)
    setLoading(false)
  }, [activeAccount])

  // Reset selected conversation when switching accounts
  useEffect(() => {
    setSelectedId(null)
    fetchConversations(true)
  }, [activeAccount?.instanceName, fetchConversations])

  useEffect(() => {
    if (!activeAccount) return

    const instanceName = activeAccount.instanceName

    const channel = supabase
      .channel(`conversations:${instanceName}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          // Server-side filter (requires REPLICA IDENTITY FULL on the table;
          // the in-callback guard below is the reliable fallback).
          filter: `instance_name=eq.${instanceName}`,
        },
        (payload) => {
          // Guard: ignore events that leaked through for other instances
          const record = (payload.new ?? payload.old ?? {}) as Record<string, string>
          if (record.instance_name && record.instance_name !== instanceName) return

          // Debounce to batch rapid events produced by bulk sync operations
          if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current)
          realtimeTimerRef.current = setTimeout(() => fetchConversations(false), 300)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current)
    }
  }, [activeAccount, fetchConversations])

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#f0f2f5]">
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
      <button
        onClick={() => setSidebarOpen((o) => !o)}
        className="absolute top-3 right-3 z-20 p-1.5 rounded-full hover:bg-[#e9edef] text-[#54656f] transition-colors"
        title={sidebarOpen ? 'Fechar painel' : 'Abrir painel'}
      >
        {sidebarOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
      </button>
      <RightSidebar
        instanceName={activeAccount?.instanceName ?? null}
        isOpen={sidebarOpen}
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

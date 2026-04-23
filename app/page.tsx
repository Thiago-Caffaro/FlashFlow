'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Conversation } from '@/types'
import ConversationList from '@/components/chat/conversation-list'
import ChatWindow from '@/components/chat/chat-window'
import TriggersTab from '@/components/sidebar-right/triggers-tab'
import FlowsTab from '@/components/flows/flows-tab'
import AiSettingsTab from '@/components/settings/ai-settings-tab'
import VerticalTabBar, { View } from '@/components/nav/vertical-tab-bar'
import { AccountProvider, useAccount } from '@/contexts/account-context'
import { ThemeProvider } from '@/contexts/theme-context'

const TAB_INDEX: Record<View, number> = { chat: 0, gatilhos: 1, fluxos: 2, ia: 3 }

function ChatApp() {
  const { activeAccount } = useAccount()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveView] = useState<View>('chat')
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

    const seen = new Set<string>()
    const unique = (data ?? []).filter((c) => {
      if (seen.has(c.wa_id)) return false
      seen.add(c.wa_id)
      return true
    })
    setConversations(unique)
    setLoading(false)
  }, [activeAccount])

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
          filter: `instance_name=eq.${instanceName}`,
        },
        (payload) => {
          const record = (payload.new ?? payload.old ?? {}) as Record<string, string>
          if (record.instance_name && record.instance_name !== instanceName) return

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
  const tabIndex = TAB_INDEX[activeView]

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#f0f2f5] dark:bg-[#0b141a]">
      {/* Sliding panels container — right-12 reserves 48px for the tab bar */}
      <div className="absolute inset-0 right-12 overflow-hidden">
        {/* Panel 0: Chat */}
        <div
          className="absolute inset-0 flex"
          style={{
            transform: `translateY(${(0 - tabIndex) * 100}%)`,
            transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'transform',
          }}
        >
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

        {/* Panel 1: Gatilhos */}
        <div
          className="absolute inset-0 bg-white dark:bg-[#111b21]"
          style={{
            transform: `translateY(${(1 - tabIndex) * 100}%)`,
            transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'transform',
          }}
        >
          {activeAccount?.instanceName ? (
            <TriggersTab instanceName={activeAccount.instanceName} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nenhuma conta ativa.</p>
            </div>
          )}
        </div>

        {/* Panel 2: Fluxos */}
        <div
          className="absolute inset-0 bg-white dark:bg-[#111b21]"
          style={{
            transform: `translateY(${(2 - tabIndex) * 100}%)`,
            transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'transform',
          }}
        >
          {activeAccount?.instanceName ? (
            <FlowsTab instanceName={activeAccount.instanceName} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nenhuma conta ativa.</p>
            </div>
          )}
        </div>

        {/* Panel 3: Config. IA */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translateY(${(3 - tabIndex) * 100}%)`,
            transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'transform',
          }}
        >
          <AiSettingsTab />
        </div>
      </div>

      {/* Vertical tab bar — always visible on right edge */}
      <VerticalTabBar activeTab={activeView} onTabChange={setActiveView} />
    </div>
  )
}

export default function Home() {
  return (
    <ThemeProvider>
      <AccountProvider>
        <ChatApp />
      </AccountProvider>
    </ThemeProvider>
  )
}

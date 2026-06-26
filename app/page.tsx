'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ChatsTab from '@/components/chats/chats-tab'
import TriggersTab from '@/components/sidebar-right/triggers-tab'
import FlowsTab from '@/components/flows/flows-tab'
import AiSettingsTab from '@/components/settings/ai-settings-tab'
import GeneralSettingsTab from '@/components/settings/general-settings-tab'
import MemoryTab from '@/components/memory/memory-tab'
import GalleryTab from '@/components/gallery/gallery-tab'
import AccountDropdown from '@/components/chat/account-dropdown'
import VerticalTabBar, { View } from '@/components/nav/vertical-tab-bar'
import { AccountProvider, useAccount } from '@/contexts/account-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { AuthProvider } from '@/contexts/auth-context'
import { FEATURES } from '@/lib/features'

// Panel positions — fixed regardless of gallery feature flag
const TAB_INDEX: Record<View, number> = {
  chats:        0,
  gatilhos:     1,
  fluxos:       2,
  memoria:      3,
  galeria:      4,
  ia:           5,
  'conf-gerais': 6,
}

function getStoredView(): View {
  if (typeof window === 'undefined') return 'chats'
  const stored = localStorage.getItem('activeView')
  return stored && stored in TAB_INDEX ? stored as View : 'chats'
}

function playEscalationSound() {
  try {
    const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const playNote = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, ctx.currentTime + start)
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur)
    }
    playNote(880, 0, 0.22)
    playNote(1174, 0.18, 0.3)
    setTimeout(() => ctx.close(), 1000)
  } catch { /* Audio bloqueado pelo browser */ }
}

function ChatApp() {
  const { activeAccount } = useAccount()
  const [activeView, setActiveView] = useState<View>(getStoredView)
  const [escalationCount, setEscalationCount] = useState(0)
  const escalationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevEscalationRef = useRef(0)
  const escalationInitialized = useRef(false)

  const handleTabChange = (v: View) => {
    setActiveView(v)
    localStorage.setItem('activeView', v)
  }

  // Escalation badge polling
  useEffect(() => {
    if (!activeAccount) { setEscalationCount(0); return }
    const instanceName = activeAccount.instanceName

    const fetchEscalationCount = async () => {
      const { count } = await supabase
        .from('ai_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('instance_name', instanceName)
        .eq('requires_human', true)
      const newCount = count ?? 0
      if (escalationInitialized.current && newCount > prevEscalationRef.current) {
        playEscalationSound()
      }
      prevEscalationRef.current = newCount
      escalationInitialized.current = true
      setEscalationCount(newCount)
    }

    fetchEscalationCount()

    const channel = supabase
      .channel(`escalations:${instanceName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_sessions' }, (payload) => {
        const record = (payload.new ?? payload.old ?? {}) as Record<string, unknown>
        if (record.instance_name && record.instance_name !== instanceName) return
        if (escalationTimerRef.current) clearTimeout(escalationTimerRef.current)
        escalationTimerRef.current = setTimeout(fetchEscalationCount, 300)
      })
      .subscribe()

    const poll = setInterval(fetchEscalationCount, 10000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
      if (escalationTimerRef.current) clearTimeout(escalationTimerRef.current)
    }
  }, [activeAccount])

  const tabIndex = TAB_INDEX[activeView]

  const noAccount = (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div>
          <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">Nenhuma conta ativa</p>
          <p className="mt-1 text-xs text-[#667781] dark:text-[#8696a0]">
            Conecte uma conta do WhatsApp para começar.
          </p>
        </div>
        <AccountDropdown />
      </div>
    </div>
  )

  const panel = (position: number, content: React.ReactNode) => (
    <div
      className="absolute inset-0"
      style={{
        transform: `translateY(${(position - tabIndex) * 100}%)`,
        transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform',
      }}
    >
      {content}
    </div>
  )

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#f0f2f5] dark:bg-[#0b141a]">
      {/* Sliding panels — right-12 reserves 48px for the tab bar */}
      <div className="absolute inset-0 right-12 overflow-hidden">

        {/* Panel 0: Chats */}
        {panel(0,
          <div className="h-full bg-white dark:bg-[#111b21]">
            {activeAccount?.instanceName
              ? <ChatsTab instanceName={activeAccount.instanceName} />
              : noAccount}
          </div>
        )}

        {/* Panel 1: Gatilhos */}
        {panel(1,
          <div className="h-full bg-white dark:bg-[#111b21]">
            {activeAccount?.instanceName
              ? <TriggersTab instanceName={activeAccount.instanceName} />
              : noAccount}
          </div>
        )}

        {/* Panel 2: Fluxos */}
        {panel(2,
          <div className="h-full bg-white dark:bg-[#111b21]">
            {activeAccount?.instanceName
              ? <FlowsTab instanceName={activeAccount.instanceName} />
              : noAccount}
          </div>
        )}

        {/* Panel 3: Memória */}
        {panel(3,
          <div className="h-full bg-white dark:bg-[#111b21]">
            {activeAccount?.instanceName
              ? <MemoryTab instanceName={activeAccount.instanceName} />
              : noAccount}
          </div>
        )}

        {/* Panel 4: Galeria (conditional) */}
        {FEATURES.gallery && panel(4,
          <div className="h-full bg-white dark:bg-[#111b21]">
            {activeAccount?.instanceName
              ? <GalleryTab instanceName={activeAccount.instanceName} />
              : noAccount}
          </div>
        )}

        {/* Panel 5: Config. IA */}
        {panel(5, <AiSettingsTab />)}

        {/* Panel 6: Conf. Gerais */}
        {panel(6,
          activeAccount?.instanceName
            ? <GeneralSettingsTab instanceName={activeAccount.instanceName} />
            : noAccount
        )}
      </div>

      {/* Tab bar */}
      <VerticalTabBar
        activeTab={activeView}
        onTabChange={handleTabChange}
        badges={{ chats: escalationCount }}
      />
    </div>
  )
}

export default function Home() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AccountProvider>
          <ChatApp />
        </AccountProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

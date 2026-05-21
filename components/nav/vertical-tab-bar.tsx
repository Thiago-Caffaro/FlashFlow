'use client'

import { useState } from 'react'
import { MessageSquare, Zap, GitBranch, Brain, BookOpen, Images, Sun, Moon, Bot, Settings2 } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'
import { FEATURES } from '@/lib/features'

export type View = 'chat' | 'gatilhos' | 'fluxos' | 'memoria' | 'galeria' | 'sessoes-ia' | 'ia' | 'conf-gerais'

interface Props {
  activeTab: View
  onTabChange: (v: View) => void
  badges?: Partial<Record<View, number>>
}

const TABS: { id: View; label: string; Icon: React.ElementType }[] = [
  { id: 'sessoes-ia' as View, label: 'Sessões IA', Icon: Bot },
  { id: 'chat',     label: 'Chat',       Icon: MessageSquare },
  { id: 'gatilhos', label: 'Gatilhos',   Icon: Zap },
  { id: 'fluxos',   label: 'Fluxos',     Icon: GitBranch },
  { id: 'memoria',  label: 'Memória',    Icon: BookOpen },
  ...(FEATURES.gallery ? [{ id: 'galeria' as View, label: 'Galeria', Icon: Images }] : []),
  { id: 'ia',         label: 'Config. IA',   Icon: Brain },
  { id: 'conf-gerais' as View, label: 'Conf. Gerais', Icon: Settings2 },
]

export default function VerticalTabBar({ activeTab, onTabChange, badges = {} }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { theme, toggleTheme } = useTheme()

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-30 flex flex-col py-4 bg-white dark:bg-[#111b21] border-l border-[#d1d7db] dark:border-[#2a3942] overflow-hidden transition-all duration-200"
      style={{ width: expanded ? 172 : 48 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Tab buttons */}
      <div className="flex flex-col gap-0.5 flex-1">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id
          const badgeCount = badges[id] ?? 0
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={[
                'relative flex flex-row-reverse items-center h-12 w-full px-3 transition-colors duration-100',
                isActive
                  ? 'bg-[#f0f2f5] dark:bg-[#2a3942] text-[#00a884]'
                  : 'text-[#54656f] dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#182229] hover:text-[#111b21] dark:hover:text-white',
              ].join(' ')}
            >
              {isActive && (
                <span className="absolute left-0 top-3 bottom-3 w-0.5 bg-[#00a884] rounded-full" />
              )}
              <div className="relative shrink-0">
                <Icon size={19} />
                {badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
              {expanded && (
                <span className="flex-1 text-right pr-3 text-sm whitespace-nowrap font-medium">
                  {label}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="flex flex-row-reverse items-center h-12 w-full px-3 text-[#54656f] dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#182229] hover:text-[#111b21] dark:hover:text-white transition-colors duration-100"
        title={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
      >
        {theme === 'light' ? <Moon size={19} className="shrink-0" /> : <Sun size={19} className="shrink-0" />}
        {expanded && (
          <span className="flex-1 text-right pr-3 text-sm whitespace-nowrap font-medium">
            {theme === 'light' ? 'Modo escuro' : 'Modo claro'}
          </span>
        )}
      </button>
    </div>
  )
}

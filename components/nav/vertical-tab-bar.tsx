'use client'

import { useState } from 'react'
import { MessageSquare, Zap, GitBranch, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'

export type View = 'chat' | 'gatilhos' | 'fluxos'

interface Props {
  activeTab: View
  onTabChange: (v: View) => void
}

const TABS: { id: View; label: string; Icon: React.ElementType }[] = [
  { id: 'chat',     label: 'Chat',     Icon: MessageSquare },
  { id: 'gatilhos', label: 'Gatilhos', Icon: Zap },
  { id: 'fluxos',   label: 'Fluxos',   Icon: GitBranch },
]

export default function VerticalTabBar({ activeTab, onTabChange }: Props) {
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
              <Icon size={19} className="shrink-0" />
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

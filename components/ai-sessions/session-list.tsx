'use client'

import { Bot, X } from 'lucide-react'
import { AISessionWithContext } from '@/types'

interface SessionListProps {
  sessions: AISessionWithContext[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onTerminate: (sessionWithCtx: AISessionWithContext) => void
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export default function SessionList({ sessions, loading, selectedId, onSelect, onTerminate }: SessionListProps) {
  if (loading) {
    return (
      <div className="flex flex-col" style={{ width: 360, minWidth: 280 }}>
        <div className="px-4 py-3 border-b border-[#d1d7db] dark:border-[#2a3942]">
          <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Sessões IA</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[#aebac1] dark:text-[#667781]">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border-r border-[#d1d7db] dark:border-[#2a3942]" style={{ width: 360, minWidth: 280 }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#d1d7db] dark:border-[#2a3942] shrink-0">
        <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Sessões IA</p>
        <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
          {sessions.length === 0
            ? 'Nenhuma sessão ativa'
            : `${sessions.length} ${sessions.length === 1 ? 'sessão ativa' : 'sessões ativas'}`}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <Bot size={40} className="text-[#aebac1] dark:text-[#667781]" />
            <p className="text-sm text-[#667781] dark:text-[#8696a0]">
              Nenhuma sessão de IA ativa no momento.
            </p>
            <p className="text-xs text-[#aebac1] dark:text-[#667781]">
              Quando um contato entrar em um fluxo com IA, ele aparecerá aqui.
            </p>
          </div>
        ) : (
          sessions.map((item) => {
            const { session, conversation, flow_name } = item
            const displayName = conversation.contact_name || conversation.contact_phone
            const isActive = selectedId === session.id

            return (
              <div
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={[
                  'relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#f0f2f5] dark:border-[#1f2c34]',
                  isActive
                    ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                    : 'hover:bg-[#f5f6f6] dark:hover:bg-[#182229]',
                ].join(' ')}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-[#dfe5e7] dark:bg-[#2a3942] flex items-center justify-center text-sm font-semibold text-[#54656f] dark:text-[#8696a0]">
                    {initials(displayName)}
                  </div>
                  {/* Active AI indicator */}
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#00a884] rounded-full border-2 border-white dark:border-[#111b21] animate-pulse" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef] truncate">
                      {displayName}
                    </p>
                    <span className="text-[10px] text-[#667781] dark:text-[#8696a0] shrink-0">
                      {formatRelativeTime(session.last_message_at)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-xs text-[#667781] dark:text-[#8696a0] truncate">
                      {flow_name ? (
                        <span className="text-[#00a884]">{flow_name}</span>
                      ) : (
                        <span className="italic">fluxo desconhecido</span>
                      )}
                    </p>
                    <span className="text-[10px] text-[#667781] dark:text-[#8696a0] shrink-0">
                      {session.max_messages
                        ? `${session.message_count}/${session.max_messages} msgs`
                        : `${session.message_count} msgs`}
                    </span>
                  </div>
                </div>

                {/* Terminate button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onTerminate(item) }}
                  title="Encerrar sessão"
                  className="shrink-0 p-1.5 rounded-full text-[#aebac1] dark:text-[#667781] hover:bg-[#fee2e2] hover:text-[#ef4444] dark:hover:bg-[#2a1c1c] dark:hover:text-[#ef4444] transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

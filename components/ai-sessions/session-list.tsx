'use client'

import { useState } from 'react'
import { AlertTriangle, Bot, CheckSquare, Square, X, Zap } from 'lucide-react'
import { AISessionWithContext } from '@/types'

type Filter = 'all' | 'escalated' | 'ai'

interface SessionListProps {
  sessions: AISessionWithContext[]
  loading: boolean
  selectedId: string | null
  filter: Filter
  onFilterChange: (f: Filter) => void
  selectedIds: Set<string>
  onItemClick: (e: React.MouseEvent, item: AISessionWithContext, index: number) => void
  onTerminate: (sessionWithCtx: AISessionWithContext) => void
  onBulkTerminate: () => void
  onClearSelection: () => void
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

interface SessionItemProps {
  item: AISessionWithContext
  index: number
  isActive: boolean
  isSelected: boolean
  selectionActive: boolean
  onItemClick: (e: React.MouseEvent, item: AISessionWithContext, index: number) => void
  onTerminate: () => void
}

function SessionItem({ item, index, isActive, isSelected, selectionActive, onItemClick, onTerminate }: SessionItemProps) {
  const { session, conversation, flow_name } = item
  const [imgError, setImgError] = useState(false)
  const displayName = conversation.contact_name || conversation.contact_phone
  const canHavePic = !conversation.wa_id.endsWith('@lid')
  const proxyUrl = canHavePic
    ? `/api/profile-picture/proxy?waId=${encodeURIComponent(conversation.wa_id)}&instance=${encodeURIComponent(conversation.instance_name)}`
    : null

  return (
    <div
      onClick={(e) => onItemClick(e, item, index)}
      className={[
        'group relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-[#f0f2f5] dark:border-[#1f2c34] select-none',
        isSelected
          ? 'bg-[#e7f8f4] dark:bg-[#00a884]/10'
          : isActive
          ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
          : 'hover:bg-[#f5f6f6] dark:hover:bg-[#182229]',
      ].join(' ')}
    >
      {/* Checkbox — visible on hover or when selection is active */}
      <div
        className={`shrink-0 transition-opacity ${isSelected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ width: 16 }}
      >
        {isSelected
          ? <CheckSquare size={15} className="text-[#00a884]" />
          : <Square size={15} className="text-[#aebac1]" />
        }
      </div>

      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-[#dfe5e7] dark:bg-[#2a3942] flex items-center justify-center text-sm font-semibold text-[#54656f] dark:text-[#8696a0] overflow-hidden select-none">
          {proxyUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxyUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            getInitials(displayName)
          )}
        </div>
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[#00a884] rounded-full border-2 border-white dark:border-[#111b21] animate-pulse" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {session.requires_human && (
              <span title="Requer atendimento humano" className="shrink-0 flex">
                <AlertTriangle size={12} className="text-amber-500" />
              </span>
            )}
            <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef] truncate">
              {displayName}
            </p>
          </div>
          <span className="text-[10px] text-[#667781] dark:text-[#8696a0] shrink-0">
            {formatRelativeTime(session.last_message_at)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="text-xs truncate">
            {flow_name ? (
              <span className="text-[#00a884]">{flow_name}</span>
            ) : (
              <span className="italic text-[#667781] dark:text-[#8696a0]">fluxo desconhecido</span>
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
        onClick={(e) => { e.stopPropagation(); onTerminate() }}
        title="Encerrar sessão"
        className="shrink-0 p-1.5 rounded-full text-[#aebac1] dark:text-[#667781] hover:bg-[#fee2e2] hover:text-[#ef4444] dark:hover:bg-[#2a1c1c] dark:hover:text-[#ef4444] transition-colors opacity-0 group-hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  )
}

const FILTER_OPTIONS: { value: Filter; label: string; Icon?: React.ElementType }[] = [
  { value: 'all',       label: 'Todos' },
  { value: 'escalated', label: 'Escalados', Icon: AlertTriangle },
  { value: 'ai',        label: 'Com IA',    Icon: Zap },
]

export default function SessionList({
  sessions,
  loading,
  selectedId,
  filter,
  onFilterChange,
  selectedIds,
  onItemClick,
  onTerminate,
  onBulkTerminate,
  onClearSelection,
}: SessionListProps) {
  const selectionActive = selectedIds.size > 0

  const header = (
    <div className="px-4 pt-4 pb-3 border-b border-[#d1d7db] dark:border-[#2a3942] shrink-0">
      {/* Title row */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Sessões IA</p>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
            {loading
              ? 'Carregando...'
              : sessions.length === 0
              ? 'Nenhuma sessão ativa'
              : `${sessions.length} ${sessions.length === 1 ? 'sessão ativa' : 'sessões ativas'}`}
          </p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1">
        {FILTER_OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            onClick={() => onFilterChange(value)}
            className={[
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              filter === value
                ? 'bg-[#00a884] text-white'
                : 'bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#3d4f5a]',
            ].join(' ')}
          >
            {Icon && <Icon size={10} />}
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full border-r border-[#d1d7db] dark:border-[#2a3942]" style={{ width: 360, minWidth: 280 }}>
        {header}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-[#aebac1] dark:text-[#667781]">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border-r border-[#d1d7db] dark:border-[#2a3942]" style={{ width: 360, minWidth: 280 }}>
      {header}

      {/* Selection toolbar */}
      {selectionActive && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#e7f8f4] dark:bg-[#00a884]/10 border-b border-[#00a884]/20 shrink-0">
          <span className="text-xs font-medium text-[#00a884]">
            {selectedIds.size} {selectedIds.size === 1 ? 'selecionado' : 'selecionados'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onBulkTerminate}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-white font-medium transition-colors"
            >
              Encerrar
            </button>
            <button
              onClick={onClearSelection}
              className="p-1 rounded-full text-[#667781] hover:bg-[#d1d7db]/40 transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <Bot size={40} className="text-[#aebac1] dark:text-[#667781]" />
            <p className="text-sm text-[#667781] dark:text-[#8696a0]">
              {filter === 'all'
                ? 'Nenhuma sessão de IA ativa no momento.'
                : filter === 'escalated'
                ? 'Nenhuma sessão escalada.'
                : 'Nenhuma sessão em atendimento pela IA.'}
            </p>
            {filter === 'all' && (
              <p className="text-xs text-[#aebac1] dark:text-[#667781]">
                Quando um contato entrar em um fluxo com IA, ele aparecerá aqui.
              </p>
            )}
          </div>
        ) : (
          sessions.map((item, index) => (
            <SessionItem
              key={item.session.id}
              item={item}
              index={index}
              isActive={selectedId === item.session.id}
              isSelected={selectedIds.has(item.session.id)}
              selectionActive={selectionActive}
              onItemClick={onItemClick}
              onTerminate={() => onTerminate(item)}
            />
          ))
        )}
      </div>
    </div>
  )
}

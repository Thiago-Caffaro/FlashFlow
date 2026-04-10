'use client'

import { useEffect, useState } from 'react'
import { Conversation } from '@/types'

interface ConversationItemProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
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

function formatTime(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()

    if (isToday) {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear()
    if (isYesterday) return 'Ontem'
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return ''
  }
}

export default function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
  const displayName = conversation.contact_name ?? conversation.contact_phone
  const initials = getInitials(conversation.contact_name, conversation.contact_phone)
  const proxyUrl = `/api/profile-picture/proxy?waId=${encodeURIComponent(conversation.wa_id)}&instance=${encodeURIComponent(conversation.instance_name)}`
  const [imgError, setImgError] = useState(false)

  // Reset erro ao trocar de contato
  useEffect(() => setImgError(false), [conversation.wa_id])

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-[#f5f6f6] transition-colors text-left border-b border-[#e9edef] ${
        isActive ? 'bg-[#f0f2f5]' : 'bg-white'
      }`}
    >
      <div className="w-12 h-12 rounded-full bg-[#dfe5e7] flex items-center justify-center text-[#667781] font-semibold text-sm shrink-0 select-none overflow-hidden">
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          initials
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-medium text-[#111b21] text-sm truncate">{displayName}</span>
          <span className="text-xs text-[#667781] shrink-0 ml-2">
            {formatTime(conversation.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[#667781] truncate">{conversation.last_message ?? ''}</p>
          {conversation.unread_count > 0 && (
            <span className="min-w-5 h-5 bg-[#00a884] text-white text-[11px] font-medium rounded-full flex items-center justify-center px-1 shrink-0">
              {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

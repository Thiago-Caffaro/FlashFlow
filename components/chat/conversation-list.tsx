'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Conversation } from '@/types'
import ConversationItem from './conversation-item'
import AccountSwitcher from './account-switcher'

interface ConversationListProps {
  conversations: Conversation[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
}: ConversationListProps) {
  const [query, setQuery] = useState('')

  const filtered = query
    ? conversations.filter((c) =>
        (c.contact_name ?? c.contact_phone).toLowerCase().includes(query.toLowerCase())
      )
    : conversations

  return (
    <div className="flex flex-col w-[360px] min-w-[280px] border-r border-[#d1d7db] bg-white h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-sm select-none">
            FF
          </div>
          <span className="font-semibold text-[#111b21] text-base">FlashFlow</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 bg-white shrink-0">
        <div className="flex items-center gap-2 bg-[#f0f2f5] rounded-lg px-3 py-2">
          <Search size={16} className="text-[#54656f] shrink-0" />
          <input
            type="text"
            placeholder="Pesquisar conversa"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-sm text-[#111b21] placeholder:text-[#667781] outline-none flex-1 min-w-0"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20 text-[#667781] text-sm">
            Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[#667781] text-sm">
            {query ? 'Nenhum resultado' : 'Nenhuma conversa'}
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === selectedId}
              onClick={() => onSelect(conv.id)}
            />
          ))
        )}
      </div>
      <AccountSwitcher />
    </div>
  )
}

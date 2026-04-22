'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Trigger, TriggerCreate } from '@/types'
import TriggerRow from './trigger-row'
import TriggerMessageModal from './trigger-message-modal'

interface TriggersTabProps {
  instanceName: string
}

export default function TriggersTab({ instanceName }: TriggersTabProps) {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [modalTrigger, setModalTrigger] = useState<Trigger | null>(null)

  const fetchTriggers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/triggers?instance=${encodeURIComponent(instanceName)}`)
      const json = await res.json()
      if (json.ok) setTriggers(json.triggers)
    } finally {
      setLoading(false)
    }
  }, [instanceName])

  useEffect(() => {
    fetchTriggers()
  }, [fetchTriggers])

  async function handleAddTrigger() {
    const body: TriggerCreate = {
      instance_name: instanceName,
      alias: '',
      tipo: 'contains',
      valor: '',
      delay_ms: 0,
      action: 'send_message',
      action_payload: { message: '' },
    }
    const res = await fetch('/api/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.ok) {
      setTriggers((prev) => [...prev, json.trigger])
    }
  }

  async function handleUpdate(id: string, changes: Partial<TriggerCreate>) {
    const res = await fetch(`/api/triggers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    const json = await res.json()
    if (json.ok) {
      setTriggers((prev) => prev.map((t) => (t.id === id ? json.trigger : t)))
      setModalTrigger((prev) => (prev?.id === id ? json.trigger : prev))
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setTriggers((prev) => prev.filter((t) => t.id !== id))
    }
  }

  async function handleSaveMessage(id: string, message: string) {
    await handleUpdate(id, { action: 'send_message', action_payload: { message } })
    setModalTrigger(null)
  }

  const filtered = searchQuery
    ? triggers.filter((t) => t.alias.toLowerCase().includes(searchQuery.toLowerCase()))
    : triggers

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + Add */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <div className="flex-1 flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg px-2 py-1.5">
          <Search size={13} className="text-[#aebac1] dark:text-[#667781] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar gatilho..."
            className="flex-1 bg-transparent text-xs text-[#111b21] dark:text-[#e9edef] placeholder-[#aebac1] dark:placeholder-[#667781] outline-none"
          />
        </div>
        <button
          onClick={handleAddTrigger}
          className="p-1.5 rounded-lg bg-[#00a884] text-white hover:bg-[#008f72] transition-colors shrink-0"
          title="Adicionar gatilho"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#f0f2f5] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] shrink-0">
        <span className="flex-1 text-[10px] font-medium text-[#aebac1] dark:text-[#667781] uppercase tracking-wide px-1">Nome</span>
        <span className="w-[90px] shrink-0 text-[10px] font-medium text-[#aebac1] dark:text-[#667781] uppercase tracking-wide px-1">Tipo</span>
        <span className="flex-1 text-[10px] font-medium text-[#aebac1] dark:text-[#667781] uppercase tracking-wide px-1">Valor</span>
        <span className="w-[84px] shrink-0 text-[10px] font-medium text-[#aebac1] dark:text-[#667781] uppercase tracking-wide px-1">Delay</span>
        <span className="w-[84px] shrink-0 text-[10px] font-medium text-[#aebac1] dark:text-[#667781] uppercase tracking-wide px-1">Ação</span>
        <span className="w-[24px] shrink-0" />
      </div>

      {/* Trigger list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <p className="text-xs text-[#aebac1] dark:text-[#667781]">Carregando...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-center px-4">
            <p className="text-xs text-[#aebac1] dark:text-[#667781]">
              {searchQuery ? 'Nenhum gatilho encontrado.' : 'Nenhum gatilho ainda.'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleAddTrigger}
                className="text-xs text-[#00a884] hover:underline"
              >
                Criar primeiro gatilho
              </button>
            )}
          </div>
        ) : (
          filtered.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              trigger={trigger}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onOpenModal={setModalTrigger}
            />
          ))
        )}
      </div>

      {modalTrigger && (
        <TriggerMessageModal
          trigger={modalTrigger}
          onSave={handleSaveMessage}
          onClose={() => setModalTrigger(null)}
        />
      )}
    </div>
  )
}

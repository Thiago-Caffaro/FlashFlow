'use client'

import { useState } from 'react'
import { Loader2, Plus, Radio, Search, Trash2, User, X } from 'lucide-react'
import { SandboxContact, SandboxRealContactResult } from '@/types'
import { getJson, sandboxBtnPrimary, sandboxInputClass } from './sandbox-styles'

interface SandboxContactsProps {
  contacts: SandboxContact[]
  activeContactId: string | null
  accountLabel: (instanceName: string | null) => string
  onSelect: (id: string | null) => void
  // Recarrega a lista; `selectId` troca o contato ativo depois de recarregar.
  onReload: (selectId?: string | null) => Promise<void>
  onMessage: (text: string, error?: boolean) => void
}

export default function SandboxContacts({
  contacts, activeContactId, accountLabel, onSelect, onReload, onMessage,
}: SandboxContactsProps) {
  const [showAddContact, setShowAddContact] = useState(false)
  const [addMode, setAddMode] = useState<'search' | 'manual'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SandboxRealContactResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [addContactBusy, setAddContactBusy] = useState(false)
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null)

  async function searchRealContacts(q: string) {
    setSearchQuery(q)
    if (q.trim().length < 2) { setSearchResults([]); return }
    setSearchBusy(true)
    const json = await fetch(`/api/fulfillment/sandbox/contacts/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' }).then(getJson)
    if (json.ok) setSearchResults(json.contacts ?? [])
    setSearchBusy(false)
  }

  async function createContact(contactName: string, contactPhone: string, sourceInstanceName?: string) {
    setAddContactBusy(true)
    const json = await fetch('/api/fulfillment/sandbox/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactName, contactPhone, sourceInstanceName }),
    }).then(getJson)
    if (json.ok) {
      setShowAddContact(false)
      setSearchQuery('')
      setSearchResults([])
      setManualName('')
      setManualPhone('')
      await onReload(json.contact.id)
    } else {
      onMessage(json.error ?? 'Erro ao adicionar contato', true)
    }
    setAddContactBusy(false)
  }

  async function removeContact(id: string) {
    if (!window.confirm('Remover este contato de teste e todo o histórico dele?')) return
    setRemoveBusyId(id)
    const json = await fetch(`/api/fulfillment/sandbox/contacts/${id}`, { method: 'DELETE' }).then(getJson)
    if (json.ok) await onReload(activeContactId === id ? null : undefined)
    else onMessage(json.error ?? 'Erro ao remover contato', true)
    setRemoveBusyId(null)
  }

  async function toggleRealSend(contact: SandboxContact) {
    const json = await fetch(`/api/fulfillment/sandbox/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ realSendEnabled: !contact.sandbox_real_send_enabled }),
    }).then(getJson)
    if (json.ok) await onReload()
    else onMessage(json.error ?? 'Erro ao atualizar contato', true)
  }

  return (
    <div className="border-b border-[#f0f2f5] px-4 py-3 dark:border-[#2a3942]">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
          {contacts.length === 0 && <p className="py-1 text-xs text-[#667781]">Nenhum contato de teste ainda.</p>}
          {contacts.map((c) => (
            <div
              key={c.id}
              className={`flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1.5 text-xs font-semibold transition-colors ${
                activeContactId === c.id
                  ? 'bg-[#00a884] text-white'
                  : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942] dark:text-[#e9edef]'
              }`}
            >
              <button
                onClick={() => onSelect(c.id)}
                className="flex items-center gap-1.5"
                title={c.sandbox_source_instance ? `Importado da conta: ${accountLabel(c.sandbox_source_instance)}` : 'Contato de teste manual (sem conta real associada)'}
              >
                <User size={12} />
                <span className="max-w-[120px] truncate">{c.contact_name || c.contact_phone || 'Sem nome'}</span>
              </button>
              {c.sandbox_source_instance && (
                <button
                  onClick={() => toggleRealSend(c)}
                  title={`Conta: ${accountLabel(c.sandbox_source_instance)} — ${c.sandbox_real_send_enabled ? 'envio real ligado, clique para desligar' : 'envio real desligado, clique para ligar'}`}
                  className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    c.sandbox_real_send_enabled
                      ? 'bg-emerald-500 text-white'
                      : activeContactId === c.id ? 'bg-white/20 text-white' : 'bg-[#e6e9ec] text-[#667781] dark:bg-[#334650]'
                  }`}
                >
                  <Radio size={9} />
                  {c.sandbox_real_send_enabled ? 'real' : 'seguro'}
                </button>
              )}
              <button
                onClick={() => removeContact(c.id)}
                disabled={removeBusyId === c.id}
                title="Remover contato de teste"
                className={activeContactId === c.id ? 'text-white/80 hover:text-white' : 'text-[#aebac1] hover:text-red-500'}
              >
                {removeBusyId === c.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowAddContact((v) => !v)}
          className="shrink-0 rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
          title={showAddContact ? 'Fechar' : 'Novo contato de teste'}
        >
          {showAddContact ? <X size={15} /> : <Plus size={15} />}
        </button>
      </div>

      {showAddContact && (
        <div className="mt-3 rounded-lg border border-[#f0f2f5] p-3 dark:border-[#2a3942]">
          <div className="mb-3 flex gap-1">
            <button
              onClick={() => setAddMode('search')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${addMode === 'search' ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942]'}`}
            >
              Importar contato real
            </button>
            <button
              onClick={() => setAddMode('manual')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${addMode === 'manual' ? 'bg-[#00a884] text-white' : 'bg-[#f0f2f5] text-[#667781] dark:bg-[#2a3942]'}`}
            >
              Digitar manualmente
            </button>
          </div>

          {addMode === 'search' ? (
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
                <input
                  className={`${sandboxInputClass} pl-8`}
                  placeholder="Buscar por nome ou telefone..."
                  value={searchQuery}
                  onChange={(e) => searchRealContacts(e.target.value)}
                />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Contatos importados entram com envio real de WhatsApp ligado — desligue no indicador do contato para só testar a lógica.
              </p>
              {searchBusy && <p className="text-xs text-[#667781]">Buscando...</p>}
              {!searchBusy && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="text-xs text-[#667781]">Nenhum contato encontrado em contas conectadas.</p>
              )}
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    disabled={addContactBusy}
                    onClick={() => createContact(c.contact_name || c.contact_phone || 'Sem nome', c.contact_phone || '', c.instance_name)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                  >
                    <span className="truncate dark:text-[#e9edef]">{c.contact_name || 'Sem nome'} · {c.contact_phone}</span>
                    <span className="shrink-0 text-xs text-[#667781]">{c.accountLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <input className={sandboxInputClass} placeholder="Nome do contato" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              <input className={sandboxInputClass} placeholder="Telefone" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
              <button
                onClick={() => createContact(manualName.trim(), manualPhone.trim())}
                disabled={addContactBusy || !manualName.trim() || !manualPhone.trim()}
                className={sandboxBtnPrimary}
              >
                {addContactBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Adicionar contato
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { Account } from '@/types'
import SyncOverlay from './sync-overlay'

type ModalStep = 'label' | 'qr'

const STATE_DOT: Record<string, string> = {
  open:       'bg-[#00a884]',
  connecting: 'bg-amber-400',
  close:      'bg-[#aebac1] dark:bg-[#667781]',
}

interface AccountDropdownProps {
  onConnectingChange?: (v: boolean) => void
}

export default function AccountDropdown({ onConnectingChange }: AccountDropdownProps) {
  const { accounts, activeAccount, setActiveAccount, refreshAccounts } = useAccount()
  const [open, setOpen] = useState(false)
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [modalStep, setModalStep] = useState<ModalStep | null>(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingInstance, setPendingInstance] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(60)
  const [syncingInstance, setSyncingInstance] = useState<string | null>(null)
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onConnectingChange?.(modalStep !== null || syncingInstance !== null || creating)
  }, [modalStep, syncingInstance, creating, onConnectingChange])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function stopTimers() {
    if (pollerRef.current) clearInterval(pollerRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    pollerRef.current = null
    timerRef.current = null
  }

  function closeModal() {
    stopTimers()
    setModalStep(null)
    setLabel('')
    setCreateError(null)
    setPendingInstance(null)
    setQrCode(null)
    setTimeLeft(60)
  }

  async function handleDeletePending(instanceName: string) {
    await fetch(`/api/accounts/${instanceName}`, { method: 'DELETE' }).catch(() => {})
    await refreshAccounts()
  }

  function startQrPoller(instanceName: string) {
    setTimeLeft(120)
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          stopTimers()
          closeModal()
          handleDeletePending(instanceName)
          return 0
        }
        return t - 1
      })
    }, 1000)

    pollerRef.current = setInterval(async () => {
      try {
        // Verifica se já conectou
        const statusRes = await fetch(`/api/accounts/${instanceName}/status`, { cache: 'no-store' })
        const { state } = await statusRes.json()
        if (state === 'open') { stopTimers(); closeModal(); setSyncingInstance(instanceName); return }

        // Busca QR se ainda não tem
        const qrRes = await fetch(`/api/accounts/${instanceName}/qr`, { cache: 'no-store' })
        const { qr } = await qrRes.json()
        if (qr) setQrCode(qr)
      } catch { /* silent */ }
    }, 3000)
  }

  async function handleCreate() {
    if (!label.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setCreateError(json.error ?? 'Erro ao criar conta'); return }
      setPendingInstance(json.instanceName)
      setModalStep('qr')
      startQrPoller(json.instanceName)
    } catch {
      setCreateError('Erro de conexão')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(account: Account) {
    setDeleting(true)
    try {
      await fetch(`/api/accounts/${account.instanceName}`, { method: 'DELETE' })
      await refreshAccounts()
      if (activeAccount?.instanceName === account.instanceName) {
        const remaining = accounts.filter((a) => a.instanceName !== account.instanceName)
        if (remaining[0]) setActiveAccount(remaining[0])
      }
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  if (!activeAccount) return null

  return (
    <>
      {syncingInstance && (
        <SyncOverlay
          instanceName={syncingInstance}
          onComplete={async () => {
            const instanceToActivate = syncingInstance
            setSyncingInstance(null)
            const fresh = await refreshAccounts()
            const newAcc = fresh.find((a) => a.instanceName === instanceToActivate)
            if (newAcc) setActiveAccount(newAcc)
            if (instanceToActivate)
              fetch(`/api/sync?instance=${instanceToActivate}`, { method: 'POST' }).catch(() => {})
            setOpen(false)
          }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#233138] rounded-xl shadow-xl p-5 w-80 space-y-3">
            <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Remover conta</p>
            <p className="text-sm text-[#667781] dark:text-[#8696a0]">
              Tem certeza que deseja remover{' '}
              <strong className="text-[#111b21] dark:text-[#e9edef]">{confirmDelete.label}</strong>?
              <br />
              Todas as conversas e mensagens dessa conta serão excluídas permanentemente.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg border border-[#d1d7db] dark:border-[#2a3942] text-sm text-[#667781] dark:text-[#8696a0] hover:bg-[#f5f6f6] dark:hover:bg-[#182229]"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg bg-red-500 text-sm text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#233138] rounded-xl shadow-xl p-5 w-80 space-y-4">

            {modalStep === 'label' && (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Nova conta</p>
                  <button onClick={closeModal} className="text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <p className="text-sm text-[#667781] dark:text-[#8696a0]">Dê um nome para identificar esta conta</p>
                <input
                  type="text"
                  placeholder="Ex: Suporte, Vendas..."
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  className="w-full border border-[#d1d7db] dark:border-[#2a3942] dark:bg-[#2a3942] dark:text-[#e9edef] rounded-lg px-3 py-2 text-sm text-[#111b21] outline-none focus:border-[#00a884]"
                  autoFocus
                />
                {createError && <p className="text-xs text-red-500">{createError}</p>}
                <button
                  onClick={handleCreate}
                  disabled={creating || !label.trim()}
                  className="w-full py-2 rounded-lg bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {creating ? <><Loader2 size={15} className="animate-spin" /> Criando...</> : 'Continuar'}
                </button>
              </>
            )}

            {modalStep === 'qr' && (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Escanear QR Code</p>
                  <button onClick={closeModal} className="text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white">
                    <X size={18} />
                  </button>
                </div>

                {qrCode ? (
                  <>
                    <div className="flex items-center justify-center py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrCode} alt="QR Code" className="w-52 h-52" />
                    </div>
                    <ol className="text-sm text-[#667781] dark:text-[#8696a0] space-y-1 list-decimal list-inside">
                      <li>Abra o WhatsApp no celular</li>
                      <li>Toque em <strong className="text-[#111b21] dark:text-[#e9edef]">Dispositivos vinculados</strong></li>
                      <li>Toque em <strong className="text-[#111b21] dark:text-[#e9edef]">Vincular um dispositivo</strong></li>
                      <li>Escaneie o QR Code acima</li>
                    </ol>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <Loader2 size={32} className="animate-spin text-[#00a884]" />
                    <p className="text-sm text-[#667781] dark:text-[#8696a0]">Gerando QR Code...</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#667781] dark:text-[#8696a0] flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Aguardando vinculação...
                  </span>
                  <span className={`text-xs font-medium ${timeLeft <= 15 ? 'text-red-500' : 'text-[#00a884]'}`}>
                    {timeLeft}s
                  </span>
                </div>
                <div className="w-full bg-[#f0f2f5] dark:bg-[#2a3942] rounded-full h-1">
                  <div
                    className="bg-[#00a884] h-1 rounded-full transition-all duration-1000"
                    style={{ width: `${(timeLeft / 120) * 100}%` }}
                  />
                </div>
              </>
            )}

          </div>
        </div>
      )}

      <div ref={ref} className="relative">
        <button
          onClick={() => { if (!open) refreshAccounts(); setOpen((v) => !v) }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors max-w-[160px]"
        >
          <span className={`shrink-0 w-2 h-2 rounded-full ${STATE_DOT[activeAccount.state]}`} />
          <span className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate">
            {activeAccount.label ?? activeAccount.instanceName}
          </span>
          <ChevronDown size={11} className={`shrink-0 text-[#667781] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl bg-white dark:bg-[#233138] border border-[#d1d7db] dark:border-[#2a3942] shadow-lg overflow-hidden">
            {accounts.map((acc) => (
              <div
                key={acc.instanceName}
                onMouseEnter={() => setHoveredName(acc.instanceName)}
                onMouseLeave={() => setHoveredName(null)}
                className={[
                  'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors',
                  acc.instanceName === activeAccount.instanceName
                    ? 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                    : 'hover:bg-[#f5f6f6] dark:hover:bg-[#182229]',
                ].join(' ')}
                onClick={() => {
                  setActiveAccount(acc)
                  setOpen(false)
                  fetch(`/api/sync?instance=${acc.instanceName}`, { method: 'POST' }).catch(() => {})
                }}
              >
                <span className={`shrink-0 w-2 h-2 rounded-full ${STATE_DOT[acc.state]}`} />
                <span className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate">
                    {acc.label || acc.instanceName}
                  </p>
                  {acc.profileName && (
                    <p className="text-[10px] text-[#667781] dark:text-[#8696a0] truncate">{acc.profileName}</p>
                  )}
                </span>
                {acc.instanceName === activeAccount.instanceName && (
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#00a884]" />
                )}
                {hoveredName === acc.instanceName && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(acc) }}
                    className="p-0.5 rounded-full hover:bg-[#e9edef] dark:hover:bg-[#3d4f5a] text-[#667781] dark:text-[#8696a0] hover:text-red-500 transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => { setModalStep('label'); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[#f5f6f6] dark:hover:bg-[#182229] transition-colors border-t border-[#f0f2f5] dark:border-[#2a3942]"
            >
              <div className="w-4 h-4 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
                <Plus size={10} className="text-white" />
              </div>
              <span className="text-xs text-[#111b21] dark:text-[#e9edef]">Adicionar conta</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Plus, X, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { Account } from '@/types'
import SyncOverlay from './sync-overlay'

type ModalStep = 'label' | 'qr'

interface QRState {
  instanceName: string
  qr: string | null
}

function StateIcon({ state }: { state: Account['state'] }) {
  if (state === 'open')
    return <span className="w-2 h-2 rounded-full bg-[#00a884] shrink-0" title="Conectado" />
  if (state === 'connecting')
    return <Loader2 size={10} className="text-yellow-500 animate-spin shrink-0" />
  return <span className="w-2 h-2 rounded-full bg-[#aebac1] shrink-0" title="Desconectado" />
}

export default function AccountSwitcher() {
  const { accounts, activeAccount, setActiveAccount, refreshAccounts } = useAccount()
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Add account modal
  const [modalStep, setModalStep] = useState<ModalStep | null>(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [qrState, setQrState] = useState<QRState | null>(null)
  const [timeLeft, setTimeLeft] = useState(60)
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Initial sync overlay
  const [syncingInstance, setSyncingInstance] = useState<string | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close panel when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function stopQrTimers() {
    if (pollerRef.current) clearInterval(pollerRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    pollerRef.current = null
    timerRef.current = null
  }

  function closeModal() {
    stopQrTimers()
    setModalStep(null)
    setLabel('')
    setCreateError(null)
    setQrState(null)
    setTimeLeft(60)
  }

  async function handleDeletePending(instanceName: string) {
    await fetch(`/api/accounts/${instanceName}`, { method: 'DELETE' }).catch(() => {})
    await refreshAccounts()
  }

  function startQrPolling(instanceName: string) {
    setTimeLeft(60)

    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          stopQrTimers()
          closeModal()
          // Verifica se conectou no último segundo antes de deletar
          fetch(`/api/accounts/${instanceName}/status`, { cache: 'no-store' })
            .then((r) => r.json())
            .then(({ state }) => {
              if (state === 'open') {
                refreshAccounts()
                setIsOpen(true)
              } else {
                handleDeletePending(instanceName)
              }
            })
            .catch(() => handleDeletePending(instanceName))
          return 0
        }
        return t - 1
      })
    }, 1000)

    pollerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/accounts/${instanceName}/status`, { cache: 'no-store' })
        const { state } = await res.json()
        if (state === 'open') {
          stopQrTimers()
          closeModal()
          // Show full-screen sync overlay for initial connection
          setSyncingInstance(instanceName)
        }
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

      if (!res.ok) {
        setCreateError(json.error ?? 'Erro ao criar conta')
        return
      }

      setQrState({ instanceName: json.instanceName, qr: json.qr })
      setModalStep('qr')
      startQrPolling(json.instanceName)
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

  const activeLabel = activeAccount?.label ?? '...'

  return (
    <>
      {/* Initial sync overlay */}
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
            setIsOpen(false)
          }}
        />
      )}

      {/* Confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-5 w-80 space-y-3">
            <p className="font-semibold text-[#111b21]">Remover conta</p>
            <p className="text-sm text-[#667781]">
              Tem certeza que deseja remover{' '}
              <strong className="text-[#111b21]">{confirmDelete.label}</strong>?
              <br />
              Todas as conversas e mensagens dessa conta serão excluídas permanentemente.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg border border-[#d1d7db] text-sm text-[#667781] hover:bg-[#f5f6f6]"
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

      {/* QR / label modal */}
      {modalStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-5 w-80 space-y-4">
            {modalStep === 'label' ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#111b21]">Nova conta</p>
                  <button onClick={closeModal} className="text-[#667781] hover:text-[#111b21]">
                    <X size={18} />
                  </button>
                </div>
                <p className="text-sm text-[#667781]">Dê um nome para identificar esta conta</p>
                <input
                  type="text"
                  placeholder="Ex: Suporte, Vendas..."
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  className="w-full border border-[#d1d7db] rounded-lg px-3 py-2 text-sm text-[#111b21] outline-none focus:border-[#00a884]"
                  autoFocus
                />
                {createError && <p className="text-xs text-red-500">{createError}</p>}
                <button
                  onClick={handleCreate}
                  disabled={creating || !label.trim()}
                  className="w-full py-2 rounded-lg bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] disabled:opacity-60"
                >
                  {creating ? 'Gerando QR...' : 'Continuar'}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#111b21]">Escanear QR Code</p>
                  <button onClick={closeModal} className="text-[#667781] hover:text-[#111b21]">
                    <X size={18} />
                  </button>
                </div>
                {qrState?.qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrState.qr} alt="QR Code" className="w-full rounded-lg" />
                ) : (
                  <div className="flex items-center justify-center h-48 text-[#667781] text-sm gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    Aguardando QR...
                  </div>
                )}
                <p className="text-xs text-[#667781] text-center">
                  Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#667781]">Expira em</span>
                  <span className={`text-xs font-medium ${timeLeft <= 10 ? 'text-red-500' : 'text-[#00a884]'}`}>
                    {timeLeft}s
                  </span>
                </div>
                <div className="w-full bg-[#f0f2f5] rounded-full h-1">
                  <div
                    className="bg-[#00a884] h-1 rounded-full transition-all duration-1000"
                    style={{ width: `${(timeLeft / 60) * 100}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Fixed bottom element inside sidebar */}
      <div ref={wrapperRef} className="relative border-t border-[#d1d7db] shrink-0">
        {/* Expanded panel */}
        {isOpen && (
          <div className="absolute bottom-full left-0 right-0 bg-white border-t border-[#d1d7db] shadow-lg z-40">
            {/* Account list */}
            <div className="max-h-60 overflow-y-auto">
              {accounts.map((account) => (
                <div
                  key={account.instanceName}
                  onMouseEnter={() => setHoveredName(account.instanceName)}
                  onMouseLeave={() => setHoveredName(null)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-[#f5f6f6] transition-colors ${
                    activeAccount?.instanceName === account.instanceName ? 'bg-[#f0f2f5]' : ''
                  }`}
                  onClick={() => {
                    setActiveAccount(account)
                    setIsOpen(false)
                    // Sincroniza em background ao trocar de conta
                    fetch(`/api/sync?instance=${account.instanceName}`, { method: 'POST' }).catch(() => {})
                  }}
                >
                  <StateIcon state={account.state} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-[#111b21] truncate block">{account.label}</span>
                    {account.state !== 'open' && (
                      <span className="text-[11px] text-[#667781]">
                        {account.state === 'connecting' ? 'Conectando...' : 'Desconectado'}
                      </span>
                    )}
                  </div>
                  {hoveredName === account.instanceName && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(account)
                      }}
                      className="p-1 rounded-full hover:bg-[#e9edef] text-[#667781] hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add account row */}
            <button
              onClick={() => {
                setModalStep('label')
                setIsOpen(false)
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f5f6f6] transition-colors border-t border-[#f0f2f5]"
            >
              <div className="w-5 h-5 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
                <Plus size={12} className="text-white" />
              </div>
              <span className="text-sm text-[#111b21]">Adicionar conta</span>
            </button>
          </div>
        )}

        {/* Trigger bar */}
        <button
          onClick={() => {
            if (!isOpen) refreshAccounts()
            setIsOpen((o) => !o)
          }}
          className="w-full flex items-center gap-2.5 px-3 py-3 bg-[#f0f2f5] hover:bg-[#e9edef] transition-colors"
        >
          {activeAccount?.state === 'open' ? (
            <Wifi size={16} className="text-[#00a884] shrink-0" />
          ) : (
            <WifiOff size={16} className="text-[#aebac1] shrink-0" />
          )}
          <span className="flex-1 text-sm text-[#111b21] text-left truncate">{activeLabel}</span>
          <ChevronUp
            size={16}
            className={`text-[#667781] transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </>
  )
}

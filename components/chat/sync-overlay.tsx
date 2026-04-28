'use client'

import { useEffect, useRef, useState } from 'react'

interface SyncOverlayProps {
  instanceName: string
  onComplete: () => void
}

interface SyncProgress {
  stage: 'idle' | 'contacts' | 'messages' | 'done' | 'error'
  total: number
  done: number
  error?: string
}

export default function SyncOverlay({ instanceName, onComplete }: SyncOverlayProps) {
  const [sync, setSync] = useState<SyncProgress>({ stage: 'contacts', total: 0, done: 0 })
  const [cancelling, setCancelling] = useState(false)
  const doneRef = useRef(false)
  const startRef = useRef(Date.now())

  useEffect(() => {
    // Start the sync
    fetch(`/api/sync/initial?instance=${encodeURIComponent(instanceName)}`, { method: 'POST' })
      .catch(() => {})

    // Poll for progress every 800ms
    const interval = setInterval(async () => {
      if (doneRef.current) return
      try {
        const res = await fetch(`/api/sync/initial?instance=${encodeURIComponent(instanceName)}`)
        const data: SyncProgress = await res.json()
        setSync(data)

        if (data.stage === 'done' || data.stage === 'error' || data.stage === 'idle') {
          doneRef.current = true
          clearInterval(interval)
          // Minimum 3s display time so the overlay doesn't flash
          const elapsed = Date.now() - startRef.current
          setTimeout(onComplete, Math.max(1200, 3000 - elapsed))
        }
      } catch { /* ignore transient errors */ }
    }, 800)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName])

  async function handleCancel() {
    if (cancelling) return
    setCancelling(true)
    try {
      await fetch(`/api/sync/initial?instance=${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    // polling will detect stage: idle and call onComplete
  }

  const isWaiting = sync.stage === 'idle' || sync.stage === 'contacts'
  const progress =
    sync.stage === 'done'
      ? 100
      : sync.stage === 'messages' && sync.total > 0
      ? Math.round((sync.done / sync.total) * 100)
      : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111b21] pointer-events-auto">
      {/* Icon */}
      <div className="mb-8 w-20 h-20 rounded-full bg-[#00a884] flex items-center justify-center">
        <svg viewBox="0 0 56 56" width="44" height="44" fill="none">
          <path
            d="M28 6C15.85 6 6 15.85 6 28c0 3.9 1.06 7.55 2.9 10.7L6 50l11.6-2.86A21.93 21.93 0 0028 50c12.15 0 22-9.85 22-22S40.15 6 28 6z"
            fill="white"
          />
        </svg>
      </div>

      <h2 className="text-white text-xl font-semibold mb-2 text-center px-8">
        Sincronização em andamento
      </h2>

      <p className="text-[#8696a0] text-sm text-center max-w-xs px-8 mb-8 leading-relaxed">
        Aguarde enquanto baixamos suas conversas.{' '}
        <span className="text-[#00a884]">Isso acontecerá apenas uma vez</span> ao conectar.
      </p>

      {/* Progress bar — indeterminate while waiting for contacts, determinate during messages */}
      <div className="w-72 mb-3">
        <div className="h-1.5 bg-[#2a3942] rounded-full overflow-hidden">
          {isWaiting ? (
            <div className="h-full w-1/3 bg-[#00a884] rounded-full" style={{ animation: 'shimmer 1.4s ease-in-out infinite' }} />
          ) : (
            <div
              className="h-full bg-[#00a884] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
      </div>

      {/* Status text */}
      <div className="text-center min-h-8">
        {isWaiting && (
          <p className="text-[#8696a0] text-xs">Buscando conversas...</p>
        )}
        {sync.stage === 'messages' && (
          <>
            <p className="text-[#8696a0] text-xs tabular-nums">
              {sync.done} / {sync.total} conversas
            </p>
            {sync.total > 0 && (
              <p className="text-[#8696a0] text-xs mt-1">
                ~{(sync.total * 30).toLocaleString('pt-BR')} mensagens estimadas
              </p>
            )}
          </>
        )}
        {sync.stage === 'done' && (
          <p className="text-[#00a884] text-xs font-medium">Concluído!</p>
        )}
        {sync.stage === 'error' && (
          <p className="text-[#f15c6d] text-xs">Erro na sincronização. Continuando...</p>
        )}
      </div>

      {!isWaiting && (
        <p className="text-[#8696a0] text-xs mt-6 tabular-nums font-mono">
          {progress}%
        </p>
      )}

      {/* Cancel button */}
      {sync.stage !== 'done' && sync.stage !== 'error' && (
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-8 text-xs text-[#8696a0] hover:text-[#f15c6d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {cancelling ? 'Cancelando...' : 'Cancelar sincronização'}
        </button>
      )}
    </div>
  )
}

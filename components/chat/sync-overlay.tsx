'use client'

import { useEffect, useRef, useState } from 'react'

interface SyncOverlayProps {
  instanceName: string
  onComplete: () => void
}

interface SyncState {
  stage: 'contacts' | 'messages' | 'done' | 'error'
  total: number
  done: number
  message?: string
}

export default function SyncOverlay({ instanceName, onComplete }: SyncOverlayProps) {
  const [sync, setSync] = useState<SyncState>({ stage: 'contacts', total: 0, done: 0 })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/sync/initial?instance=${encodeURIComponent(instanceName)}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data: SyncState = JSON.parse(e.data)
        setSync(data)
        if (data.stage === 'done' || data.stage === 'error') {
          es.close()
          // Small delay so the user sees 100% before the overlay disappears
          setTimeout(onComplete, 1200)
        }
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      es.close()
      setTimeout(onComplete, 1000)
    }

    return () => es.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName])

  const progress =
    sync.stage === 'done'
      ? 100
      : sync.stage === 'messages' && sync.total > 0
      ? Math.round((sync.done / sync.total) * 100)
      : sync.stage === 'contacts'
      ? 0
      : 100

  const estimatedMsgs = sync.total > 0 ? sync.total * 30 : null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111b21]">
      {/* Logo / icon */}
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
        Aguarde alguns minutos enquanto baixamos suas conversas.{' '}
        <span className="text-[#00a884]">Isso acontecerá apenas uma vez</span> ao conectar.
      </p>

      {/* Progress bar */}
      <div className="w-72 mb-3">
        <div className="h-1.5 bg-[#2a3942] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#00a884] rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="text-center">
        {sync.stage === 'contacts' && (
          <p className="text-[#8696a0] text-xs">Buscando conversas...</p>
        )}
        {sync.stage === 'messages' && (
          <>
            <p className="text-[#8696a0] text-xs tabular-nums">
              {sync.done} / {sync.total} conversas
            </p>
            {estimatedMsgs && (
              <p className="text-[#8696a0] text-xs mt-1">
                ~{estimatedMsgs.toLocaleString('pt-BR')} mensagens estimadas
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

      <p className="text-[#8696a0] text-xs mt-8 tabular-nums font-mono">
        {progress}%
      </p>
    </div>
  )
}

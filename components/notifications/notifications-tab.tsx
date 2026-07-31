'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellRing, Check, CheckCheck, Loader2, UserRoundCheck } from 'lucide-react'
import { AppNotification } from '@/types'

interface Props {
  instanceName: string
  onUnreadCountChange?: (count: number) => void
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function NotificationsTab({ instanceName, onUnreadCountChange }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  const loadNotifications = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`/api/notifications?instance=${encodeURIComponent(instanceName)}`, { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar notificacoes')
      setNotifications(json.notifications ?? [])
      onUnreadCountChange?.(json.unreadCount ?? 0)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar notificacoes')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [instanceName, onUnreadCountChange])

  useEffect(() => {
    void loadNotifications(true)
    const poll = window.setInterval(() => void loadNotifications(), 5000)
    return () => window.clearInterval(poll)
  }, [loadNotifications])

  async function markRead(id?: string) {
    setUpdating(true)
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceName, ...(id ? { id } : {}) }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao atualizar notificacao')
      await loadNotifications()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar notificacao')
    } finally {
      setUpdating(false)
    }
  }

  const unreadCount = notifications.filter((notification) => !notification.read_at).length

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#111b21]">
      <header className="flex min-h-20 items-center gap-4 border-b border-[#e4e7e9] px-6 dark:border-[#2a3942]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
          <BellRing size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[#111b21] dark:text-[#e9edef]">Notificacoes</h1>
          <p className="text-xs text-[#667781] dark:text-[#8696a0]">
            {unreadCount === 0 ? 'Tudo em dia' : `${unreadCount} nao lida${unreadCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void markRead()}
          disabled={updating || unreadCount === 0}
          title="Marcar todas como lidas"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#54656f] hover:bg-[#f0f2f5] disabled:opacity-40 dark:text-[#aebac1] dark:hover:bg-[#2a3942]"
        >
          <CheckCheck size={16} />
          <span className="hidden sm:inline">Marcar todas</span>
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[#8696a0]">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : error && notifications.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-500">{error}</div>
        ) : notifications.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Bell size={30} className="text-[#aebac1] dark:text-[#667781]" />
            <div>
              <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">Nenhuma notificacao</p>
              <p className="mt-1 text-xs text-[#667781] dark:text-[#8696a0]">Escalonamentos e alertas dos fluxos aparecerao aqui.</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col divide-y divide-[#e4e7e9] dark:divide-[#2a3942]">
            {error && <p className="px-5 py-3 text-xs text-red-500">{error}</p>}
            {notifications.map((notification) => {
              const Icon = notification.type === 'escalation' ? UserRoundCheck : BellRing
              return (
                <article
                  key={notification.id}
                  className={`flex gap-4 px-5 py-4 transition-colors ${notification.read_at ? 'bg-white dark:bg-[#111b21]' : 'bg-rose-50/60 dark:bg-rose-950/10'}`}
                >
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${notification.type === 'escalation' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400'}`}>
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{notification.title}</h2>
                      <time className="shrink-0 text-[11px] text-[#8696a0]">{formatDate(notification.created_at)}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#54656f] dark:text-[#aebac1]">{notification.message}</p>
                  </div>
                  {!notification.read_at && (
                    <button
                      type="button"
                      onClick={() => void markRead(notification.id)}
                      disabled={updating}
                      title="Marcar como lida"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#667781] hover:bg-white disabled:opacity-50 dark:text-[#8696a0] dark:hover:bg-[#2a3942]"
                    >
                      <Check size={16} />
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

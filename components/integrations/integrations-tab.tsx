'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plug } from 'lucide-react'
import { SlackConnectionStatus } from '@/types'
import SlackConnectionCard from './slack-connection-card'
import SlackForwardingCard from './slack-forwarding-card'

interface IntegrationsTabProps {
  instanceName: string | null
}

export default function IntegrationsTab({ instanceName }: IntegrationsTabProps) {
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/integrations/slack', { cache: 'no-store' })
      const json = await response.json()
      if (json.ok) setStatus(json.status)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  return (
    <div className="h-full overflow-y-auto bg-[#f0f2f5] dark:bg-[#0b141a]">
      <div className="mx-auto max-w-5xl p-4 sm:p-9">
        <div className="mb-8 flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#611f69]/10">
            <Plug size={28} className="text-[#611f69] dark:text-[#c084fc]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">Integrações</h2>
            <p className="mt-0.5 text-sm text-[#aebac1] dark:text-[#667781]">
              Slack: avisos de atendimento humano dos fluxos e das notificações, com botão &quot;Assumir atendimento&quot;.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SlackConnectionCard status={status} loading={loading} onStatusChange={setStatus} />
          {instanceName ? (
            <SlackForwardingCard
              key={instanceName}
              instanceName={instanceName}
              connected={Boolean(status?.connected)}
            />
          ) : (
            <div className="rounded-2xl bg-white p-7 text-sm text-[#667781] shadow-sm dark:bg-[#111b21] dark:text-[#8696a0]">
              Conecte uma conta do WhatsApp para configurar os encaminhamentos.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Send } from 'lucide-react'
import { SlackChannel, SlackMention, SlackNotificationSettings } from '@/types'

interface SlackForwardingCardProps {
  instanceName: string
  connected: boolean
}

type ForwardField = 'forward_ai_escalation' | 'forward_flow_notify' | 'forward_outside_window'

const FORWARD_OPTIONS: { field: ForwardField; label: string; description: string }[] = [
  {
    field: 'forward_ai_escalation',
    label: 'Escalonamento da IA',
    description: 'Quando o agente de IA pede atendimento humano ("Chat escalado").',
  },
  {
    field: 'forward_flow_notify',
    label: 'Node "Notificar" dos fluxos',
    description: 'As notificações internas que os fluxos já criam.',
  },
  {
    field: 'forward_outside_window',
    label: 'Fora da janela de 24h',
    description: 'Mensagem do fluxo não enviada por estar fora da janela da WhatsApp Cloud API.',
  },
]

const inputClass = 'w-full rounded-xl border border-transparent bg-[#f0f2f5] px-4 py-3 text-sm text-[#111b21] outline-none transition-colors focus:border-[#611f69] disabled:opacity-50 dark:bg-[#2a3942] dark:text-[#e9edef] dark:focus:border-[#c084fc]'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]'

export default function SlackForwardingCard({ instanceName, connected }: SlackForwardingCardProps) {
  const [settings, setSettings] = useState<SlackNotificationSettings | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  // Alternativa à lista: funciona só com chat:write (sem channels:read).
  const [manualChannelId, setManualChannelId] = useState('')

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`/api/integrations/slack/settings?instance=${encodeURIComponent(instanceName)}`, { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar configuração')
      setSettings(json.settings)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar configuração')
    }
  }, [instanceName])

  const loadChannels = useCallback(async () => {
    if (!connected) return
    setLoadingChannels(true)
    try {
      const response = await fetch('/api/integrations/slack/channels', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao listar canais')
      setChannels(json.channels ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao listar canais')
    } finally {
      setLoadingChannels(false)
    }
  }, [connected])

  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => { void loadChannels() }, [loadChannels])

  async function update(patch: Partial<Omit<SlackNotificationSettings, 'instance_name'>>) {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/slack/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceName, ...patch }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao salvar')
      setSettings(json.settings)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const response = await fetch('/api/integrations/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceName }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao enviar teste')
      setTestResult('Mensagem de teste enviada — confira o canal no Slack.')
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Falha ao enviar teste')
    } finally {
      setTesting(false)
    }
  }

  const disabled = !connected || !settings || saving

  return (
    <div className="space-y-5 rounded-2xl bg-white p-7 shadow-sm dark:bg-[#111b21]">
      <div>
        <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Notificações desta conta</h3>
        <p className="mt-0.5 text-xs text-[#8696a0]">
          Conta WhatsApp <strong>{instanceName}</strong>. O canal padrão também é usado pelos nodes Slack sem canal próprio.
        </p>
      </div>

      {!connected && (
        <p className="rounded-lg bg-[#f0f2f5] px-3 py-2 text-xs text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]">
          Conecte o Slack ao lado para configurar os encaminhamentos.
        </p>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="slack-default-channel" className="text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">Canal padrão</label>
          <button
            type="button"
            onClick={() => void loadChannels()}
            disabled={!connected || loadingChannels}
            className="flex items-center gap-1 text-[11px] text-[#8696a0] hover:text-[#111b21] disabled:opacity-50 dark:hover:text-[#e9edef]"
          >
            {loadingChannels ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Atualizar canais
          </button>
        </div>
        <select
          id="slack-default-channel"
          value={settings?.channel_id ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const channel = channels.find((item) => item.id === event.target.value)
            void update({ channel_id: event.target.value || null, channel_name: channel ? `#${channel.name}` : null })
          }}
          className={inputClass}
        >
          <option value="">Nenhum canal</option>
          {settings?.channel_id && !channels.some((channel) => channel.id === settings.channel_id) && (
            <option value={settings.channel_id}>{settings.channel_name ?? settings.channel_id}</option>
          )}
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.is_private ? '🔒 ' : '#'}{channel.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="slack-manual-channel" className={labelClass}>Ou cole o ID do canal</label>
        <div className="flex gap-2">
          <input
            id="slack-manual-channel"
            value={manualChannelId}
            onChange={(event) => setManualChannelId(event.target.value.trim().toUpperCase())}
            disabled={disabled}
            placeholder="C0123ABCDEF"
            className={inputClass}
          />
          <button
            type="button"
            disabled={disabled || !/^[CG][A-Z0-9]{6,30}$/.test(manualChannelId)}
            onClick={() => {
              void update({ channel_id: manualChannelId, channel_name: manualChannelId })
              setManualChannelId('')
            }}
            className="shrink-0 rounded-xl border border-[#d1d7db] px-4 text-sm font-medium text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-50 dark:border-[#3d4f5a] dark:text-[#e9edef] dark:hover:bg-[#2a3942]"
          >
            Usar
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[#8696a0]">
          No Slack: abra o canal → nome do canal → no rodapé aparece o ID (começa com C). Canal privado: convide o bot com /invite antes.
        </p>
      </div>

      <div>
        <label htmlFor="slack-default-mention" className={labelClass}>Mencionar por padrão</label>
        <select
          id="slack-default-mention"
          value={settings?.mention ?? 'none'}
          disabled={disabled}
          onChange={(event) => void update({ mention: event.target.value as SlackMention })}
          className={inputClass}
        >
          <option value="none">Ninguém</option>
          <option value="here">@here — quem está online no canal</option>
          <option value="channel">@channel — todos do canal</option>
        </select>
      </div>

      <div>
        <p className={labelClass}>Encaminhar automaticamente ao Slack</p>
        <div className="space-y-2">
          {FORWARD_OPTIONS.map((option) => (
            <label
              key={option.field}
              className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                settings?.[option.field]
                  ? 'border-[#611f69] bg-[#611f69]/5 dark:border-[#c084fc] dark:bg-[#611f69]/20'
                  : 'border-[#d1d7db] dark:border-[#3d4f5a]'
              } ${disabled || !settings?.channel_id ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={Boolean(settings?.[option.field])}
                disabled={disabled || !settings?.channel_id}
                onChange={(event) => void update({ [option.field]: event.target.checked })}
                className="mt-0.5 accent-[#611f69]"
              />
              <span>
                <span className="block text-sm font-medium text-[#111b21] dark:text-[#e9edef]">{option.label}</span>
                <span className="mt-0.5 block text-xs text-[#667781] dark:text-[#8696a0]">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {connected && settings && !settings.channel_id && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Escolha o canal padrão para ativar os encaminhamentos.</p>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {testResult && <p className="text-xs text-[#008f72] dark:text-[#00a884]">{testResult}</p>}

      <button
        type="button"
        onClick={() => void sendTest()}
        disabled={disabled || testing || !settings?.channel_id}
        className="flex items-center gap-2 rounded-xl border border-[#d1d7db] px-4 py-2 text-sm font-medium text-[#111b21] hover:bg-[#f0f2f5] disabled:opacity-50 dark:border-[#3d4f5a] dark:text-[#e9edef] dark:hover:bg-[#2a3942]"
      >
        {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        Enviar mensagem de teste
      </button>
    </div>
  )
}

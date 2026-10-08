'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Headset, Loader2, RefreshCw } from 'lucide-react'
import { FlowNode, FlowNodeData, SlackChannel, SlackMention } from '@/types'
import VariablePicker from './variable-picker'

interface SlackNotifyConfigProps {
  node: FlowNode
  instanceName: string
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}

type Field = 'slackTitle' | 'slackMessage'

const inputClass = 'w-full rounded-lg border border-[#d1d7db] bg-[#f8f9fa] px-3 py-2.5 text-sm text-[#111b21] outline-none focus:border-[#611f69] dark:border-[#3d4f5a] dark:bg-[#182229] dark:text-[#e9edef] dark:focus:border-[#c084fc]'
const labelClass = 'mb-2 block text-xs font-semibold uppercase text-[#667781] dark:text-[#8696a0]'

export default function SlackNotifyConfig({ node, instanceName, onChange }: SlackNotifyConfigProps) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const lastFocused = useRef<Field>('slackMessage')

  const title = typeof node.data.slackTitle === 'string' ? node.data.slackTitle : ''
  const message = typeof node.data.slackMessage === 'string' ? node.data.slackMessage : ''
  const channelId = typeof node.data.slackChannelId === 'string' ? node.data.slackChannelId : ''
  const mention = node.data.slackMention ?? ''
  const handoff = node.data.slackHandoff !== false

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true)
    try {
      const statusRes = await fetch('/api/integrations/slack', { cache: 'no-store' })
      const statusJson = await statusRes.json()
      const isConnected = Boolean(statusJson.ok && statusJson.status?.connected)
      setConnected(isConnected)
      if (!isConnected) {
        setChannels([])
        return
      }
      const res = await fetch('/api/integrations/slack/channels', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao listar canais do Slack')
      setChannels(json.channels ?? [])
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao listar canais do Slack')
    } finally {
      setLoadingChannels(false)
    }
  }, [])

  useEffect(() => {
    void loadChannels()
  }, [loadChannels])

  function insertVariable(key: string) {
    const placeholder = `{{${key}}}`
    const field = lastFocused.current
    const element = field === 'slackTitle' ? titleRef.current : messageRef.current
    const current = field === 'slackTitle' ? title : message
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? current.length
    onChange(node.id, { [field]: `${current.slice(0, start)}${placeholder}${current.slice(end)}` })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + placeholder.length, start + placeholder.length)
    })
  }

  function selectChannel(id: string) {
    const channel = channels.find((item) => item.id === id)
    onChange(node.id, { slackChannelId: id || undefined, slackChannelName: channel ? `#${channel.name}` : undefined })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg bg-[#611f69]/10 p-3 text-[#611f69] dark:bg-[#611f69]/25 dark:text-[#e9d5ff]">
        <Headset size={16} className="mt-0.5 shrink-0" />
        <p className="text-xs leading-relaxed">
          Avisa a equipe no Slack que esta conversa precisa de atendimento humano, com o botão <strong>Assumir atendimento</strong>. Também cria uma notificação na aba Notificações.
        </p>
      </div>

      {connected === false && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Slack não conectado. Conecte na aba Integrações — enquanto isso, só a notificação interna é criada.
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor={`slack-channel-${node.id}`} className="text-xs font-semibold uppercase text-[#667781] dark:text-[#8696a0]">Canal</label>
          <button
            type="button"
            onClick={() => void loadChannels()}
            disabled={loadingChannels}
            className="flex items-center gap-1 text-[11px] text-[#8696a0] hover:text-[#111b21] disabled:opacity-50 dark:hover:text-[#e9edef]"
          >
            {loadingChannels ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Atualizar
          </button>
        </div>
        <select
          id={`slack-channel-${node.id}`}
          value={channelId}
          onChange={(event) => selectChannel(event.target.value)}
          className={inputClass}
        >
          <option value="">Canal padrão da conta (aba Integrações)</option>
          {channelId && !channels.some((channel) => channel.id === channelId) && (
            <option value={channelId}>{node.data.slackChannelName || channelId}</option>
          )}
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.is_private ? '🔒 ' : '#'}{channel.name}
            </option>
          ))}
        </select>
        {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
        <p className="mt-1.5 text-[11px] text-[#8696a0]">Canais privados só aparecem depois de convidar o bot (/invite) no Slack.</p>
      </div>

      <div>
        <label htmlFor={`slack-title-${node.id}`} className={labelClass}>Título</label>
        <input
          ref={titleRef}
          id={`slack-title-${node.id}`}
          value={title}
          maxLength={120}
          onFocus={() => { lastFocused.current = 'slackTitle' }}
          onChange={(event) => onChange(node.id, { slackTitle: event.target.value })}
          placeholder="Atendimento humano solicitado"
          className={inputClass}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor={`slack-message-${node.id}`} className="text-xs font-semibold uppercase text-[#667781] dark:text-[#8696a0]">Mensagem</label>
          <span className="text-[11px] text-[#8696a0]">{message.length}/2000</span>
        </div>
        <textarea
          ref={messageRef}
          id={`slack-message-${node.id}`}
          rows={6}
          maxLength={2000}
          value={message}
          onFocus={() => { lastFocused.current = 'slackMessage' }}
          onChange={(event) => onChange(node.id, { slackMessage: event.target.value })}
          placeholder="Ex: {{contato.nome_completo}} pediu para falar com um atendente sobre o pedido {{pedido.numero}}."
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </div>

      <div>
        <label htmlFor={`slack-mention-${node.id}`} className={labelClass}>Mencionar</label>
        <select
          id={`slack-mention-${node.id}`}
          value={mention}
          onChange={(event) => onChange(node.id, { slackMention: (event.target.value || undefined) as SlackMention | undefined })}
          className={inputClass}
        >
          <option value="">Padrão da conta (aba Integrações)</option>
          <option value="none">Ninguém</option>
          <option value="here">@here — quem está online no canal</option>
          <option value="channel">@channel — todos do canal</option>
        </select>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#d1d7db] p-3 dark:border-[#3d4f5a]">
        <input
          type="checkbox"
          checked={handoff}
          onChange={(event) => onChange(node.id, { slackHandoff: event.target.checked })}
          className="mt-0.5 accent-[#611f69]"
        />
        <span>
          <span className="block text-sm font-medium text-[#111b21] dark:text-[#e9edef]">Transferir para humano</span>
          <span className="mt-0.5 block text-xs text-[#667781] dark:text-[#8696a0]">
            Encerra o fluxo neste ponto e para a IA desta conversa. Desligado, o fluxo segue para o próximo node depois de avisar.
          </span>
        </span>
      </label>

      <VariablePicker instanceName={instanceName} onInsert={insertVariable} />
    </div>
  )
}

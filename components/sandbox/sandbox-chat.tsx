'use client'

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Radio, Reply, RotateCcw, Send } from 'lucide-react'
import { FlowReplyButton, Message, SandboxContact } from '@/types'
import MessageBubble from '@/components/chat/message-bubble'
import { getJson, sandboxBtnPrimary, sandboxInputClass } from './sandbox-styles'

interface SandboxChatProps {
  activeContact: SandboxContact | null
  // Só consulta o servidor com a aba Sandbox aberta e a janela visível —
  // o app principal mantém todos os painéis montados.
  active: boolean
  accountLabel: (instanceName: string | null) => string
  onMessage: (text: string, error?: boolean) => void
  headerActions?: ReactNode
}

const POLL_MS = 3000

export default function SandboxChat({ activeContact, active, accountLabel, onMessage, headerActions }: SandboxChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  // Botões do fluxo pausado esperando resposta (flow_run waiting_confirmation).
  const [replyButtons, setReplyButtons] = useState<FlowReplyButton[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const activeContactId = activeContact?.id ?? null

  const loadChat = useCallback(async () => {
    const qs = activeContactId ? `?conversationId=${encodeURIComponent(activeContactId)}` : ''
    const json = await fetch(`/api/fulfillment/sandbox/message${qs}`, { cache: 'no-store' }).then(getJson)
    if (json.ok) {
      setMessages(json.messages ?? [])
      setReplyButtons(Array.isArray(json.replyButtons) ? json.replyButtons : [])
    }
  }, [activeContactId])

  useEffect(() => {
    if (!active) return
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadChat()
    }
    void loadChat()
    const interval = window.setInterval(refreshWhenVisible, POLL_MS)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [active, loadChat])

  useEffect(() => { shouldStickToBottomRef.current = true }, [activeContactId])

  useEffect(() => {
    const chat = chatScrollRef.current
    if (chat && shouldStickToBottomRef.current) chat.scrollTop = chat.scrollHeight
  }, [messages])

  async function sendChatMessage(override?: string) {
    const text = (override ?? chatInput).trim()
    if (!text) return
    setChatBusy(true)
    if (override === undefined) setChatInput('')
    setReplyButtons([])
    shouldStickToBottomRef.current = true
    const json = await fetch('/api/fulfillment/sandbox/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, conversationId: activeContactId }),
    }).then(getJson)
    if (!json.ok) onMessage(json.error ?? 'Erro ao enviar mensagem', true)
    await loadChat()
    setChatBusy(false)
  }

  async function resetConversation() {
    setResetBusy(true)
    const json = await fetch('/api/fulfillment/sandbox/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeContactId }),
    }).then(getJson)
    onMessage(json.ok ? 'Conversa reiniciada.' : (json.error ?? 'Erro ao reiniciar'), !json.ok)
    await loadChat()
    setResetBusy(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[#f0f2f5] px-4 py-2.5 dark:border-[#2a3942]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold dark:text-[#e9edef]">
            Conversa de teste {activeContact && <span className="font-normal text-[#667781]">· {activeContact.contact_name || activeContact.contact_phone}</span>}
          </p>
          <p className="text-xs text-[#667781]">Fale como se fosse o cliente. A IA responde de verdade.</p>
        </div>
        <button
          onClick={resetConversation}
          disabled={resetBusy}
          className="shrink-0 rounded-lg p-1.5 text-[#667781] hover:bg-[#f0f2f5] disabled:opacity-40 dark:hover:bg-[#2a3942]"
          title="Reinicia a conversa e o histórico do contato selecionado"
        >
          {resetBusy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
        </button>
        {headerActions}
      </div>

      {activeContact?.sandbox_real_send_enabled ? (
        <div className="flex items-start gap-2 border-b border-[#f0f2f5] bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 dark:border-[#2a3942] dark:bg-red-900/20 dark:text-red-400">
          <Radio size={12} className="mt-0.5 shrink-0" />
          Envio real ligado — as mensagens chegam de verdade no WhatsApp de {activeContact.contact_name || activeContact.contact_phone}, pela conta {accountLabel(activeContact.sandbox_source_instance)}.
        </div>
      ) : (
        <div className="border-b border-[#f0f2f5] bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-[#2a3942] dark:bg-amber-900/20 dark:text-amber-400">
          Envio real desligado — nada sai pro WhatsApp de verdade. O bot só responde se houver um gatilho do sandbox apontando para um fluxo.
        </div>
      )}

      <div
        ref={chatScrollRef}
        onScroll={(event) => {
          const chat = event.currentTarget
          shouldStickToBottomRef.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-[#efeae2] p-3 dark:bg-[#0b141a]"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-[#667781]">Nenhuma mensagem ainda. Envie algo abaixo para começar.</p>
        )}
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {replyButtons.length > 0 && (
          // Toque num botão = o cliente respondendo com o texto dele, como no WhatsApp.
          <div className="ml-auto flex w-full max-w-[85%] flex-col gap-1 pt-1" aria-label="Botões de resposta">
            {replyButtons.map((button) => (
              <button
                key={button.id}
                onClick={() => void sendChatMessage(button.label)}
                disabled={chatBusy}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-[#027eb5] shadow-sm hover:bg-[#f5f6f6] disabled:opacity-50 dark:bg-[#202c33] dark:text-[#53bdeb] dark:hover:bg-[#2a3942]"
              >
                <Reply size={14} />
                {button.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-[#f0f2f5] p-3 dark:border-[#2a3942]">
        <input
          className={sandboxInputClass}
          placeholder="Digite como se fosse o cliente..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !chatBusy) void sendChatMessage() }}
        />
        <button onClick={() => void sendChatMessage()} disabled={chatBusy || !chatInput.trim()} className={sandboxBtnPrimary} aria-label="Enviar">
          {chatBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

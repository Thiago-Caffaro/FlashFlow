'use client'

import { useEffect, useState, useCallback } from 'react'

interface DiagData {
  ts: string
  accounts: { instance_name: string; label: string }[]
  instanceStates: Record<string, unknown>
  qrCacheKeys: string[]
  recentWebhooks: { ts: string; event: string; instance: string; data: string }[]
  recentMessages: {
    id: string
    conversation_id: string
    content: string
    type: string
    direction: string
    status: string
    created_at: string
    wa_message_id: string
  }[]
  evoStatus: { name: string; status: string; profileName: string | null }[] | { error: string }
}

function getState(instanceStates: Record<string, unknown>, name: string): string {
  const s = instanceStates[name] as Record<string, unknown> | undefined
  if (!s) return '?'
  if ((s as Record<string, string>).error) return `erro: ${(s as Record<string, string>).error}`
  const inst = (s as Record<string, Record<string, unknown>>).instance ?? s
  return String((inst as Record<string, unknown>).state ?? (inst as Record<string, unknown>).connectionStatus ?? '?')
}

function badge(state: string) {
  const s = state.toLowerCase()
  if (s === 'open') return 'bg-green-500'
  if (s === 'connecting' || s === 'qrcode') return 'bg-yellow-500'
  return 'bg-red-500'
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagData | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [sendForm, setSendForm] = useState({ instance: '', number: '', message: '' })
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/diagnostics', { cache: 'no-store' })
      const json = await res.json()
      setData(json)
    } catch (e) {
      console.error('diagnostics fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchData, 5000)
    return () => clearInterval(id)
  }, [autoRefresh, fetchData])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!sendForm.instance || !sendForm.number || !sendForm.message) return
    setSending(true)
    setSendResult(null)
    try {
      // Busca conversationId pela instância e número
      const convRes = await fetch(
        `/api/conversations?instanceName=${sendForm.instance}&waId=${sendForm.number}@s.whatsapp.net`,
        { cache: 'no-store' }
      )
      const convData = await convRes.json()
      const conv = Array.isArray(convData?.conversations)
        ? convData.conversations.find(
            (c: { instance_name: string; wa_id: string }) =>
              c.instance_name === sendForm.instance &&
              (c.wa_id === `${sendForm.number}@s.whatsapp.net` || c.wa_id === sendForm.number)
          )
        : null

      if (!conv) {
        setSendResult(`Conversa não encontrada para ${sendForm.number} na instância ${sendForm.instance}. Tente enviar direto pela Evolution API primeiro.`)
        return
      }

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conv.id,
          waId: conv.wa_id,
          content: sendForm.message,
        }),
      })
      const json = await res.json()
      setSendResult(res.ok ? `✓ Enviado! msgId: ${json.message?.wa_message_id ?? '?'}` : `✗ Erro: ${json.error}`)
    } catch (e) {
      setSendResult(`Erro de conexão: ${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  const cell = 'px-3 py-2 text-xs text-left align-top'
  const th = `${cell} font-semibold text-[#8696a0] uppercase tracking-wide`
  const td = `${cell} text-[#e9edef] font-mono`

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b141a] text-[#8696a0] text-sm">
        Carregando diagnóstico...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b141a] text-red-400 text-sm">
        Falha ao carregar dados
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] p-6 space-y-6 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">FlashFlow — Diagnóstico Técnico</h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Agora: {new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date().toLocaleTimeString('pt-BR')}
            {' · '}Última atualização: {new Date(data.ts).toLocaleTimeString('pt-BR')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[#8696a0] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[#00a884]"
            />
            Auto-refresh 5s
          </label>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-[#00a884] text-white text-xs rounded-lg hover:bg-[#008f72]"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Instâncias */}
      <section className="bg-[#111b21] rounded-xl border border-[#2a3942] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a3942]">
          <h2 className="text-sm font-semibold text-white">Instâncias ({data.accounts.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#182229]">
              <tr>
                <th className={th}>Nome</th>
                <th className={th}>Label</th>
                <th className={th}>connectionState (live)</th>
                <th className={th}>QR em cache</th>
                <th className={th}>fetchInstances</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((acc) => {
                const liveState = getState(data.instanceStates, acc.instance_name)
                const hasQr = data.qrCacheKeys.includes(acc.instance_name)
                const evoAcc = Array.isArray(data.evoStatus)
                  ? data.evoStatus.find((e) => e.name === acc.instance_name)
                  : null
                return (
                  <tr key={acc.instance_name} className="border-t border-[#2a3942]">
                    <td className={td}>{acc.instance_name}</td>
                    <td className={`${td} text-[#8696a0]`}>{acc.label}</td>
                    <td className={td}>
                      <span className={`inline-flex items-center gap-1.5`}>
                        <span className={`w-2 h-2 rounded-full ${badge(liveState)}`} />
                        {liveState}
                      </span>
                    </td>
                    <td className={td}>
                      <span className={hasQr ? 'text-green-400' : 'text-[#667781]'}>
                        {hasQr ? '✓ sim' : '✗ não'}
                      </span>
                    </td>
                    <td className={`${td} text-[#8696a0]`}>
                      {evoAcc ? `${evoAcc.status}${evoAcc.profileName ? ` (${evoAcc.profileName})` : ''}` : '—'}
                    </td>
                  </tr>
                )
              })}
              {data.accounts.length === 0 && (
                <tr><td colSpan={5} className={`${td} text-[#667781] text-center py-4`}>Nenhuma conta</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Teste de envio */}
      <section className="bg-[#111b21] rounded-xl border border-[#2a3942] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Teste de Envio de Mensagem</h2>
        <form onSubmit={handleSend} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8696a0]">Instância</label>
            <select
              value={sendForm.instance}
              onChange={(e) => setSendForm((f) => ({ ...f, instance: e.target.value }))}
              className="bg-[#2a3942] border border-[#3d4f5a] text-[#e9edef] text-xs rounded px-2 py-1.5 outline-none"
            >
              <option value="">selecionar...</option>
              {data.accounts.map((a) => (
                <option key={a.instance_name} value={a.instance_name}>{a.label || a.instance_name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8696a0]">Número (só dígitos)</label>
            <input
              type="text"
              placeholder="5511999999999"
              value={sendForm.number}
              onChange={(e) => setSendForm((f) => ({ ...f, number: e.target.value.replace(/\D/g, '') }))}
              className="bg-[#2a3942] border border-[#3d4f5a] text-[#e9edef] text-xs rounded px-2 py-1.5 outline-none w-40"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs text-[#8696a0]">Mensagem</label>
            <input
              type="text"
              placeholder="Teste de envio"
              value={sendForm.message}
              onChange={(e) => setSendForm((f) => ({ ...f, message: e.target.value }))}
              className="bg-[#2a3942] border border-[#3d4f5a] text-[#e9edef] text-xs rounded px-2 py-1.5 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={sending || !sendForm.instance || !sendForm.number || !sendForm.message}
            className="px-3 py-1.5 bg-[#00a884] text-white text-xs rounded hover:bg-[#008f72] disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
        {sendResult && (
          <p className={`text-xs px-3 py-2 rounded ${sendResult.startsWith('✓') ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
            {sendResult}
          </p>
        )}
      </section>

      {/* Últimos webhooks */}
      <section className="bg-[#111b21] rounded-xl border border-[#2a3942] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a3942]">
          <h2 className="text-sm font-semibold text-white">Últimos Webhooks Recebidos ({data.recentWebhooks.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#182229]">
              <tr>
                <th className={th}>Hora</th>
                <th className={th}>Evento</th>
                <th className={th}>Instância</th>
                <th className={th}>Data preview</th>
              </tr>
            </thead>
            <tbody>
              {data.recentWebhooks.map((w, i) => (
                <tr key={i} className="border-t border-[#2a3942]">
                  <td className={`${td} text-[#667781] whitespace-nowrap`}>
                    {new Date(w.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className={td}>
                    <span className={`
                      ${w.event.includes('qrcode') ? 'text-yellow-400' : ''}
                      ${w.event.includes('messages') ? 'text-blue-400' : ''}
                      ${w.event === 'connection.update' ? 'text-purple-400' : ''}
                    `}>
                      {w.event}
                    </span>
                  </td>
                  <td className={`${td} text-[#8696a0]`}>{w.instance}</td>
                  <td className={`${td} text-[#667781] max-w-xs truncate`}>{w.data}</td>
                </tr>
              ))}
              {data.recentWebhooks.length === 0 && (
                <tr><td colSpan={4} className={`${td} text-[#667781] text-center py-4`}>Nenhum webhook recebido ainda</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Últimas mensagens */}
      <section className="bg-[#111b21] rounded-xl border border-[#2a3942] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a3942]">
          <h2 className="text-sm font-semibold text-white">Últimas Mensagens Salvas ({data.recentMessages.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#182229]">
              <tr>
                <th className={th}>Hora</th>
                <th className={th}>Direção</th>
                <th className={th}>Tipo</th>
                <th className={th}>Status</th>
                <th className={th}>Conteúdo</th>
                <th className={th}>ConvID</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMessages.map((m) => (
                <tr key={m.id} className="border-t border-[#2a3942]">
                  <td className={`${td} text-[#667781] whitespace-nowrap`}>
                    {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className={td}>
                    <span className={m.direction === 'inbound' ? 'text-green-400' : 'text-blue-400'}>
                      {m.direction === 'inbound' ? '↓ in' : '↑ out'}
                    </span>
                  </td>
                  <td className={`${td} text-[#8696a0]`}>{m.type}</td>
                  <td className={`${td} text-[#8696a0]`}>{m.status}</td>
                  <td className={`${td} max-w-xs truncate`}>{m.content}</td>
                  <td className={`${td} text-[#667781] text-[10px]`}>{m.conversation_id.slice(0, 8)}…</td>
                </tr>
              ))}
              {data.recentMessages.length === 0 && (
                <tr><td colSpan={6} className={`${td} text-[#667781] text-center py-4`}>Nenhuma mensagem no banco</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

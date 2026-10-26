'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, GitBranch, Loader2, ShieldCheck, Zap } from 'lucide-react'
import { AgentMemoryBlock, Flow, Trigger, TriggerSource } from '@/types'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import SandboxQuickWindow from './sandbox-quick-window'
import { getJson } from './sandbox-styles'

export type SandboxSection = 'gatilhos' | 'fluxos' | 'memoria'

interface SandboxOverviewProps {
  // Recarrega sempre que a visão geral volta a ficar visível, para refletir
  // o que foi editado nas outras sub-abas.
  visible: boolean
  onOpen: (section: SandboxSection, itemId?: string) => void
  onMessage: (text: string, error?: boolean) => void
}

const SOURCE_LABEL: Record<TriggerSource, string> = {
  message: 'Mensagem',
  shopify_order: 'Pedido Shopify',
  delivery_status: 'Status de entrega',
  shopify_abandoned_checkout: 'Carrinho abandonado',
  lightfunnels_order: 'Pedido Lightfunnels',
}

const instanceQuery = `instance=${encodeURIComponent(SANDBOX_INSTANCE_NAME)}`

const rowClass = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#182229]'

export default function SandboxOverview({ visible, onOpen, onMessage }: SandboxOverviewProps) {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [blocks, setBlocks] = useState<AgentMemoryBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [triggerRes, flowRes, memoryRes] = await Promise.all([
      fetch(`/api/triggers?${instanceQuery}`, { cache: 'no-store' }).then(getJson),
      fetch(`/api/flows?${instanceQuery}`, { cache: 'no-store' }).then(getJson),
      fetch(`/api/memory-blocks?${instanceQuery}`, { cache: 'no-store' }).then(getJson),
    ])
    if (triggerRes.ok) setTriggers(triggerRes.triggers ?? [])
    if (flowRes.ok) setFlows(flowRes.flows ?? [])
    if (memoryRes.ok) setBlocks(memoryRes.blocks ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (visible) void load()
  }, [visible, load])

  async function toggleFlow(flow: Flow) {
    setToggleBusyId(flow.id)
    const json = await fetch(`/api/flows/${flow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !flow.ativo, instance_name: SANDBOX_INSTANCE_NAME }),
    }).then(getJson)
    if (json.ok && json.flow) setFlows((prev) => prev.map((f) => (f.id === flow.id ? json.flow : f)))
    else onMessage(json.error ?? 'Erro ao atualizar fluxo', true)
    setToggleBusyId(null)
  }

  const flowById = new Map(flows.map((f) => [f.id, f]))
  const messageTriggers = triggers.filter((t) => t.source === 'message')
  const triggersToInactiveFlow = triggers.filter((t) => {
    if (t.action !== 'flow' || !t.action_payload.flow_id) return false
    const flow = flowById.get(t.action_payload.flow_id)
    return !flow || !flow.ativo
  })

  const triggerWarning = !loading && messageTriggers.length === 0
    ? 'Sem gatilho de mensagem: o bot não responde na conversa de teste.'
    : triggersToInactiveFlow.length > 0
      ? `${triggersToInactiveFlow.length} gatilho(s) apontam para fluxo inativo ou removido.`
      : null

  return (
    <div className="@container space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-[#111b21]">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#00a884]" />
        <div className="min-w-0 flex-1 text-xs text-[#667781] dark:text-[#8696a0]">
          <p className="font-semibold text-[#111b21] dark:text-[#e9edef]">Conta de testes isolada</p>
          <p className="mt-0.5">
            Gatilhos, fluxos e memória abaixo são só da conta sandbox. Pedidos simulados nunca chegam ao FenixCOD nem à loja Shopify real, e mensagens só saem de verdade para contatos com envio real ligado.
          </p>
        </div>
        {loading && <Loader2 size={14} className="shrink-0 animate-spin text-[#00a884]" />}
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <SandboxQuickWindow
          title="Gatilhos"
          Icon={Zap}
          count={triggers.length}
          loading={loading}
          emptyText="Nenhum gatilho — clique para criar o primeiro."
          warning={triggerWarning}
          onOpen={() => onOpen('gatilhos')}
        >
          {triggers.map((t) => {
            const flow = t.action_payload.flow_id ? flowById.get(t.action_payload.flow_id) : undefined
            const target = t.action === 'flow'
              ? (flow ? flow.name : 'fluxo removido')
              : 'mensagem fixa'
            return (
              <button key={t.id} onClick={() => onOpen('gatilhos', t.id)} className={rowClass}>
                <Zap size={13} className="shrink-0 text-[#8696a0]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#111b21] dark:text-[#e9edef]">
                    {t.alias || t.valor || SOURCE_LABEL[t.source]}
                  </span>
                  <span className="block truncate text-[11px] text-[#667781]">
                    {SOURCE_LABEL[t.source]} → {target}
                  </span>
                </span>
                {t.action === 'flow' && (!flow || !flow.ativo) && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    inativo
                  </span>
                )}
              </button>
            )
          })}
        </SandboxQuickWindow>

        <SandboxQuickWindow
          title="Fluxos"
          Icon={GitBranch}
          count={flows.length}
          loading={loading}
          emptyText="Nenhum fluxo — clique para criar o primeiro."
          onOpen={() => onOpen('fluxos')}
        >
          {flows.map((f) => (
            <div key={f.id} className={rowClass}>
              <button onClick={() => onOpen('fluxos', f.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Abrir no editor">
                <GitBranch size={13} className="shrink-0 text-[#8696a0]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#111b21] dark:text-[#e9edef]">{f.name}</span>
                  <span className="block text-[11px] text-[#667781]">
                    {f.ativo ? 'Ativo' : 'Inativo'} · editado {new Date(f.updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={f.ativo}
                aria-label={f.ativo ? `Desativar ${f.name}` : `Ativar ${f.name}`}
                onClick={() => void toggleFlow(f)}
                disabled={toggleBusyId === f.id}
                className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${f.ativo ? 'bg-[#00a884]' : 'bg-[#8696a0]'}`}
                title={f.ativo ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
              >
                <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${f.ativo ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </SandboxQuickWindow>

        <SandboxQuickWindow
          title="Memória"
          Icon={BookOpen}
          count={blocks.length}
          loading={loading}
          emptyText="Nenhum bloco de memória — clique para criar o primeiro."
          onOpen={() => onOpen('memoria')}
        >
          {blocks.map((b) => (
            <button key={b.id} onClick={() => onOpen('memoria', b.id)} className={rowClass}>
              <BookOpen size={13} className="shrink-0 text-[#8696a0]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[#111b21] dark:text-[#e9edef]">{b.name}</span>
                <span className="block truncate text-[11px] text-[#667781]">
                  {b.type === 'always' ? 'Core — sempre no prompt' : `Contextual · ${b.keywords.slice(0, 3).join(', ') || 'sem palavras-chave'}`}
                </span>
              </span>
            </button>
          ))}
        </SandboxQuickWindow>
      </div>
    </div>
  )
}

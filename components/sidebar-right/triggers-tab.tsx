'use client'

import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Plus, Search, Trash2, MessageSquare, GitBranch, Zap, Download, Upload, X, ShoppingBag, ShoppingCart, Truck } from 'lucide-react'
import { DELIVERY_STATUSES, ItemFocusRequest, Trigger, TriggerCreate, TriggerTipo, TriggerAction, type DeliveryStatus } from '@/types'
import FlowPickerModal from '@/components/flows/flow-picker-modal'

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface TriggersTabProps {
  instanceName: string
  focus?: ItemFocusRequest | null
}

const DELAY_OPTIONS = [
  { label: 'Imediato', value: 0 },
  { label: '1 segundo', value: 1000 },
  { label: '5 segundos', value: 5000 },
  { label: 'Personalizado', value: -1 },
]

function resolveDelayOption(delay_ms: number) {
  if (delay_ms === 0) return 0
  if (delay_ms === 1000) return 1000
  if (delay_ms === 5000) return 5000
  return -1
}

// Mesmo padrão de lib/shopify-confirmation-service.ts (DEFAULT_ABANDONED_CHECKOUT_DELAY_MS)
// — aquele módulo é server-only, por isso o valor é repetido aqui.
const DEFAULT_CHECKOUT_DELAY_MS = 60 * 60 * 1000

function checkoutDelayMinutes(delay_ms: number) {
  return Math.round((delay_ms > 0 ? delay_ms : DEFAULT_CHECKOUT_DELAY_MS) / 60_000)
}

function actionLabel(action: TriggerAction) {
  return action === 'send_message' ? 'Mensagem' : 'Fluxo'
}

function tipoLabel(tipo: TriggerTipo) {
  return tipo === 'contains' ? 'Contém' : 'Igual a'
}

// ─── Context panel ────────────────────────────────────────────────────────────

interface PanelProps {
  trigger: Trigger
  onUpdate: (id: string, changes: Partial<TriggerCreate>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
  instanceName: string
}

function TriggerPanel({ trigger, onUpdate, onDelete, onClose, instanceName }: PanelProps) {
  const [alias, setAlias] = useState(trigger.alias)
  const [valorTags, setValorTags] = useState<string[]>(
    () => trigger.valor ? trigger.valor.split(',').map(v => v.trim()).filter(Boolean) : []
  )
  const [valorInput, setValorInput] = useState('')
  const [customDelaySeconds, setCustomDelaySeconds] = useState(
    resolveDelayOption(trigger.delay_ms) === -1 ? String(trigger.delay_ms / 1000) : '3'
  )
  const [checkoutDelayInput, setCheckoutDelayInput] = useState(() => String(checkoutDelayMinutes(trigger.delay_ms)))
  const [flowPickerOpen, setFlowPickerOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const delayOption = resolveDelayOption(trigger.delay_ms)
  // O delay do carrinho é de minutos/horas; levado para outra origem viraria
  // um "delay de resposta" absurdo — zera ao trocar.
  const resetCheckoutDelay: Partial<TriggerCreate> = trigger.source === 'shopify_abandoned_checkout' ? { delay_ms: 0 } : {}
  const deliveryStatuses = trigger.action_payload.statuses ?? []

  function toggleDeliveryStatus(status: DeliveryStatus) {
    const next = deliveryStatuses.includes(status)
      ? deliveryStatuses.filter((item) => item !== status)
      : [...deliveryStatuses, status]
    onUpdate(trigger.id, {
      action: 'flow',
      action_payload: { ...trigger.action_payload, statuses: next },
    })
  }

  function addValorTag(raw: string) {
    const word = raw.trim()
    if (!word || valorTags.includes(word)) return
    const next = [...valorTags, word]
    setValorTags(next)
    setValorInput('')
    onUpdate(trigger.id, { valor: next.join(',') })
  }

  function removeValorTag(tag: string) {
    const next = valorTags.filter(t => t !== tag)
    setValorTags(next)
    onUpdate(trigger.id, { valor: next.join(',') })
  }

  function handleValorKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addValorTag(valorInput)
    } else if (e.key === 'Backspace' && !valorInput && valorTags.length > 0) {
      removeValorTag(valorTags[valorTags.length - 1])
    }
  }

  const inputClass =
    'w-full bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent focus:border-[#00a884] rounded-xl px-4 py-3 text-sm text-[#111b21] dark:text-[#e9edef] outline-none transition-colors placeholder:text-[#aebac1] dark:placeholder:text-[#667781]'

  const labelClass = 'text-xs font-semibold text-[#667781] dark:text-[#8696a0] mb-1.5 block uppercase tracking-wide'

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-[#00a884]" />
          <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">
            {trigger.alias || 'Gatilho sem nome'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors"
        >
          Fechar
        </button>
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* Alias */}
        <div>
          <label className={labelClass}>Nome do gatilho</label>
          <input
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onBlur={() => { if (alias !== trigger.alias) onUpdate(trigger.id, { alias }) }}
            placeholder="Ex: Boas-vindas, Suporte..."
            className={inputClass}
          />
        </div>

        {/* Origem do gatilho */}
        <div>
          <label className={labelClass}>Origem</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onUpdate(trigger.id, { ...resetCheckoutDelay, source: 'message' })}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                trigger.source === 'message'
                  ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] text-[#aebac1] dark:text-[#667781]'
              }`}
            >
              <MessageSquare size={14} />
              Mensagem recebida
            </button>
            <button
              type="button"
              onClick={() => onUpdate(trigger.id, { ...resetCheckoutDelay, source: 'shopify_order', action: 'flow' })}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                trigger.source === 'shopify_order'
                  ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] text-[#aebac1] dark:text-[#667781]'
              }`}
            >
              <ShoppingBag size={14} />
              Pedido Shopify criado
            </button>
            <button
              type="button"
              onClick={() => onUpdate(trigger.id, { ...resetCheckoutDelay, source: 'lightfunnels_order', action: 'flow' })}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                trigger.source === 'lightfunnels_order'
                  ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] text-[#aebac1] dark:text-[#667781]'
              }`}
            >
              <ShoppingBag size={14} />
              Pedido Lightfunnels criado
            </button>
            <button
              type="button"
              onClick={() => onUpdate(trigger.id, {
                ...resetCheckoutDelay,
                source: 'delivery_status',
                action: 'flow',
                action_payload: { ...trigger.action_payload, statuses: deliveryStatuses },
              })}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                trigger.source === 'delivery_status'
                  ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] text-[#aebac1] dark:text-[#667781]'
              }`}
            >
              <Truck size={14} />
              Entrega atualizada
            </button>
            <button
              type="button"
              onClick={() => {
                const delayMs = trigger.delay_ms >= 60_000 ? trigger.delay_ms : DEFAULT_CHECKOUT_DELAY_MS
                setCheckoutDelayInput(String(checkoutDelayMinutes(delayMs)))
                onUpdate(trigger.id, { source: 'shopify_abandoned_checkout', action: 'flow', delay_ms: delayMs })
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                trigger.source === 'shopify_abandoned_checkout'
                  ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] text-[#aebac1] dark:text-[#667781]'
              }`}
            >
              <ShoppingCart size={14} />
              Carrinho abandonado
            </button>
          </div>
        </div>

        {trigger.source === 'shopify_abandoned_checkout' ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
              <ShoppingCart size={13} className="text-[#667781] mt-0.5 shrink-0" />
              <p className="text-xs text-[#667781] leading-relaxed">
                Roda o fluxo abaixo quando um cliente deixa o checkout da Shopify sem comprar. O tempo conta a partir da última atividade dele no checkout; se ele comprar antes disso, nada é enviado. Carrinhos sem telefone são ignorados. Use {'{{carrinho.link}}'} na mensagem para o link de retomada.
              </p>
            </div>
            <div>
              <label className={labelClass}>Enviar após (minutos sem atividade)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={checkoutDelayInput}
                onChange={(e) => setCheckoutDelayInput(e.target.value)}
                onBlur={() => {
                  const minutes = Math.trunc(Number(checkoutDelayInput))
                  if (Number.isFinite(minutes) && minutes >= 1) {
                    onUpdate(trigger.id, { delay_ms: minutes * 60_000 })
                  } else {
                    setCheckoutDelayInput(String(checkoutDelayMinutes(trigger.delay_ms)))
                  }
                }}
                className={inputClass + ' max-w-[160px]'}
              />
              <p className="mt-1.5 text-xs text-[#aebac1] dark:text-[#667781]">
                Para uma sequência de lembretes (ex: 1h e 24h), crie um gatilho para cada tempo.
              </p>
            </div>
          </div>
        ) : trigger.source === 'shopify_order' ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
            <ShoppingBag size={13} className="text-[#667781] mt-0.5 shrink-0" />
            <p className="text-xs text-[#667781] leading-relaxed">
              Este gatilho roda o fluxo abaixo assim que um pedido Shopify for criado para esta conta — em vez de uma mensagem de confirmação fixa. Se nenhum fluxo estiver vinculado, nenhuma mensagem automática é enviada.
            </p>
          </div>
        ) : trigger.source === 'lightfunnels_order' ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
            <ShoppingBag size={13} className="text-[#667781] mt-0.5 shrink-0" />
            <p className="text-xs text-[#667781] leading-relaxed">
              Este gatilho roda o fluxo abaixo quando um pedido Lightfunnels é confirmado (depois dos upsells) e cai nesta conta — pelos vínculos da integração Lightfunnels, que podem separar contas por funil. Se nenhum fluxo estiver vinculado, nenhuma mensagem automática é enviada.
            </p>
          </div>
        ) : trigger.source === 'delivery_status' ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
              <Truck size={13} className="text-[#667781] mt-0.5 shrink-0" />
              <p className="text-xs text-[#667781] leading-relaxed">
                O fluxo será enfileirado somente quando o FenixCOD mudar o pedido para um dos estados selecionados.
              </p>
            </div>
            <div>
              <label className={labelClass}>Estados que ativam o fluxo</label>
              <div className="grid grid-cols-2 gap-2">
                {DELIVERY_STATUSES.map((status) => (
                  <label
                    key={status}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      deliveryStatuses.includes(status)
                        ? 'border-[#00a884] bg-[#e7f8f4] text-[#008f72] dark:bg-[#0d2e27]'
                        : 'border-[#d1d7db] text-[#667781] dark:border-[#3d4f5a] dark:text-[#aebac1]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={deliveryStatuses.includes(status)}
                      onChange={() => toggleDeliveryStatus(status)}
                      className="accent-[#00a884]"
                    />
                    {status}
                  </label>
                ))}
              </div>
              {deliveryStatuses.length === 0 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Selecione ao menos um estado para ativar este gatilho.
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Tipo de detecção */}
            <div>
              <label className={labelClass}>Tipo de detecção</label>
              <select
                value={trigger.tipo}
                onChange={(e) => onUpdate(trigger.id, { tipo: e.target.value as TriggerTipo })}
                className={inputClass + ' cursor-pointer'}
              >
                <option value="contains">Contém</option>
                <option value="exact">Igual a</option>
              </select>
            </div>

            {/* Palavras de ativação */}
            <div>
              <label className={labelClass}>Palavras de ativação</label>
              {valorTags.includes('*') && (
                <p className="text-xs text-amber-500 dark:text-amber-400 mb-1.5">
                  Qualquer mensagem ativa este gatilho
                </p>
              )}
              <div
                className="min-h-[46px] w-full bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent focus-within:border-[#00a884] rounded-xl px-3 py-2 flex flex-wrap gap-1.5 cursor-text transition-colors"
                onClick={() => (document.getElementById(`valor-input-${trigger.id}`) as HTMLInputElement | null)?.focus()}
              >
                {valorTags.map(tag => (
                  <span
                    key={tag}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium ${
                      tag === '*'
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                        : 'bg-[#00a884]/15 text-[#00a884]'
                    }`}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeValorTag(tag) }}
                      className="hover:text-red-500 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  id={`valor-input-${trigger.id}`}
                  type="text"
                  value={valorInput}
                  onChange={(e) => setValorInput(e.target.value)}
                  onKeyDown={handleValorKeyDown}
                  onBlur={() => { if (valorInput.trim()) addValorTag(valorInput) }}
                  placeholder={valorTags.length === 0 ? 'Digite e pressione Enter...' : ''}
                  className="flex-1 min-w-[100px] bg-transparent text-sm text-[#111b21] dark:text-[#e9edef] outline-none placeholder:text-[#aebac1] dark:placeholder:text-[#667781] font-mono"
                />
              </div>
            </div>
          </>
        )}

        {/* Delay — o gatilho de carrinho tem seu próprio campo em minutos acima */}
        {trigger.source !== 'shopify_abandoned_checkout' && (
        <div>
          <label className={labelClass}>Delay de resposta</label>
          <div className="flex gap-3">
            <select
              value={delayOption}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v !== -1) onUpdate(trigger.id, { delay_ms: v })
              }}
              className={inputClass + ' cursor-pointer'}
            >
              {DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {delayOption === -1 && (
              <input
                type="number"
                min="0"
                step="0.5"
                value={customDelaySeconds}
                onChange={(e) => setCustomDelaySeconds(e.target.value)}
                onBlur={() => {
                  const s = parseFloat(customDelaySeconds)
                  if (!isNaN(s) && s >= 0) onUpdate(trigger.id, { delay_ms: Math.round(s * 1000) })
                }}
                placeholder="segundos"
                className={inputClass + ' max-w-[120px]'}
              />
            )}
          </div>
        </div>
        )}

        {/* Flow picker */}
        <div>
          <label className={labelClass}>Fluxo vinculado</label>
          <button
            onClick={() => setFlowPickerOpen(true)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
              trigger.action_payload.flow_id
                ? 'border-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27]'
                : 'border-dashed border-[#d1d7db] dark:border-[#3d4f5a] hover:border-[#00a884]'
            }`}
          >
            <GitBranch size={16} className={trigger.action_payload.flow_id ? 'text-[#00a884]' : 'text-[#aebac1] dark:text-[#667781]'} />
            <span className={`text-sm ${trigger.action_payload.flow_id ? 'text-[#00a884] font-medium' : 'text-[#aebac1] dark:text-[#667781]'}`}>
              {trigger.action_payload.message
                ? trigger.action_payload.message
                : 'Clique para selecionar um fluxo'}
            </span>
          </button>
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-6 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <button
          onClick={async () => {
            setDeleting(true)
            await onDelete(trigger.id)
            onClose()
          }}
          disabled={deleting}
          className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} />
          {deleting ? 'Removendo...' : 'Remover gatilho'}
        </button>
      </div>

      {flowPickerOpen && (
        <FlowPickerModal
          instanceName={instanceName}
          selectedFlowId={trigger.action_payload.flow_id ?? null}
          onSelect={(flowId, flowName) => {
            onUpdate(trigger.id, {
              action: 'flow',
              action_payload: { ...trigger.action_payload, flow_id: flowId, message: flowName },
            })
            setFlowPickerOpen(false)
          }}
          onClose={() => setFlowPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function TriggersTab({ instanceName, focus = null }: TriggersTabProps) {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const fetchTriggers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/triggers?instance=${encodeURIComponent(instanceName)}`)
      const json = await res.json()
      if (json.ok) setTriggers(json.triggers)
    } finally {
      setLoading(false)
    }
  }, [instanceName])

  useEffect(() => { fetchTriggers() }, [fetchTriggers])

  // Abre o gatilho pedido de fora (mini janelas do Sandbox) uma vez por clique.
  const handledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || handledFocusRef.current === focus.nonce) return
    if (!triggers.some((t) => t.id === focus.id)) return
    handledFocusRef.current = focus.nonce
    setSelectedId(focus.id)
  }, [focus, triggers])

  async function handleAdd() {
    const body: TriggerCreate = {
      instance_name: instanceName,
      alias: '',
      tipo: 'contains',
      valor: '',
      delay_ms: 0,
      action: 'flow',
      action_payload: {},
      source: 'message',
    }
    const res = await fetch('/api/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.ok) {
      setTriggers((prev) => [...prev, json.trigger])
      setSelectedId(json.trigger.id)
    }
  }

  async function handleUpdate(id: string, changes: Partial<TriggerCreate>) {
    const res = await fetch(`/api/triggers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...changes, instance_name: instanceName }),
    })
    const json = await res.json()
    if (json.ok) setTriggers((prev) => prev.map((t) => (t.id === id ? json.trigger : t)))
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/triggers/${id}?instance=${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setTriggers((prev) => prev.filter((t) => t.id !== id))
      if (selectedId === id) setSelectedId(null)
    }
  }

  function handleExportAll() {
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(
      {
        flashflow_export: 'triggers',
        version: 1,
        triggers: triggers.map(({ alias, tipo, valor, delay_ms, action, action_payload, source }) => ({
          alias,
          tipo,
          valor,
          delay_ms,
          action,
          source,
          // flow_id não é exportado — IDs são específicos de cada instância
          action_payload: action === 'send_message'
            ? action_payload
            : { statuses: action_payload.statuses ?? [] },
        })),
      },
      `flashflow-triggers-${instanceName}-${date}.json`
    )
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (data.flashflow_export !== 'triggers') {
        alert('Arquivo inválido. Use um JSON de gatilhos exportado pelo FlashFlow.')
        return
      }

      type TriggerPayload = Omit<TriggerCreate, 'instance_name'>
      const toImport: TriggerPayload[] = data.triggers ?? []

      for (const t of toImport) {
        await fetch('/api/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_name: instanceName,
            alias: t.alias ?? '',
            tipo: t.tipo ?? 'contains',
            valor: t.valor ?? '',
            delay_ms: t.delay_ms ?? 0,
            action: t.action ?? 'send_message',
            action_payload: t.action_payload ?? { message: '' },
            source: t.source ?? 'message',
          }),
        })
      }

      await fetchTriggers()
    } catch {
      alert('Erro ao ler o arquivo. Verifique se é um JSON válido.')
    } finally {
      setImporting(false)
    }
  }

  const filtered = searchQuery
    ? triggers.filter((t) => t.alias.toLowerCase().includes(searchQuery.toLowerCase()))
    : triggers

  const selectedTrigger = triggers.find((t) => t.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: table ── */}
      <div className="flex flex-col w-1/2 border-r border-[#f0f2f5] dark:border-[#2a3942] min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
          <div className="flex-1 flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-xl px-3 py-2">
            <Search size={14} className="text-[#aebac1] dark:text-[#667781] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar gatilho..."
              className="flex-1 bg-transparent text-sm text-[#111b21] dark:text-[#e9edef] placeholder-[#aebac1] dark:placeholder-[#667781] outline-none"
            />
          </div>
          <button
            onClick={handleExportAll}
            title="Exportar todos os gatilhos"
            disabled={triggers.length === 0}
            className="p-2 rounded-xl text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors disabled:opacity-30 shrink-0"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => importRef.current?.click()}
            title="Importar gatilhos"
            disabled={importing}
            className="p-2 rounded-xl text-[#aebac1] dark:text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors disabled:opacity-30 shrink-0"
          >
            <Upload size={16} />
          </button>
          <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#00a884] text-white text-sm font-medium hover:bg-[#008f72] transition-colors shrink-0"
          >
            <Plus size={14} />
            Novo
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2 border-b border-[#f0f2f5] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#182229] shrink-0">
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Nome / Valor</span>
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Tipo</span>
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] uppercase tracking-wide">Ação</span>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-sm text-[#aebac1] dark:text-[#667781]">Carregando...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <p className="text-sm text-[#aebac1] dark:text-[#667781]">
                {searchQuery ? 'Nenhum gatilho encontrado.' : 'Nenhum gatilho ainda.'}
              </p>
              {!searchQuery && (
                <button onClick={handleAdd} className="text-sm text-[#00a884] hover:underline">
                  Criar primeiro gatilho
                </button>
              )}
            </div>
          ) : (
            filtered.map((t) => {
              const isSelected = t.id === selectedId
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  className={`w-full grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] text-left transition-colors ${
                    isSelected
                      ? 'bg-[#e7f8f4] dark:bg-[#0d2e27]'
                      : 'hover:bg-[#f8f9fa] dark:hover:bg-[#182229]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${isSelected ? 'text-[#00a884]' : 'text-[#111b21] dark:text-[#e9edef]'}`}>
                      {t.alias || <em className="not-italic text-[#aebac1] dark:text-[#667781] font-normal">Sem nome</em>}
                    </p>
                    <p className="text-xs text-[#aebac1] dark:text-[#667781] font-mono truncate mt-0.5">
                      {t.source === 'shopify_order'
                        ? <em className="not-italic font-sans">Pedido Shopify criado</em>
                        : t.source === 'lightfunnels_order'
                          ? <em className="not-italic font-sans">Pedido Lightfunnels criado</em>
                        : t.source === 'shopify_abandoned_checkout'
                          ? <em className="not-italic font-sans">Após {checkoutDelayMinutes(t.delay_ms)} min sem atividade</em>
                        : t.source === 'delivery_status'
                          ? <em className="not-italic font-sans">{t.action_payload.statuses?.join(', ') || 'Nenhum estado selecionado'}</em>
                        : (t.valor
                          ? t.valor.split(',').map(v => v.trim()).filter(Boolean).join(', ')
                          : <em className="not-italic font-sans">—</em>)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] shrink-0">
                    {t.source === 'shopify_order' || t.source === 'lightfunnels_order' ? <ShoppingBag size={10} /> : null}
                    {t.source === 'delivery_status' ? <Truck size={10} /> : null}
                    {t.source === 'shopify_abandoned_checkout' ? <ShoppingCart size={10} /> : null}
                    {t.source === 'shopify_order' || t.source === 'lightfunnels_order'
                      ? 'Pedido'
                      : t.source === 'delivery_status'
                        ? 'Entrega'
                        : t.source === 'shopify_abandoned_checkout' ? 'Carrinho' : tipoLabel(t.tipo)}
                  </span>
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    t.action === 'flow'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                      : 'bg-[#e7f8f4] dark:bg-[#0d2e27] text-[#00a884]'
                  }`}>
                    {t.action === 'flow' ? <GitBranch size={10} /> : <MessageSquare size={10} />}
                    {actionLabel(t.action)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: context panel ── */}
      <div className="flex flex-col w-1/2 min-h-0 bg-white dark:bg-[#111b21]">
        {selectedTrigger ? (
          <TriggerPanel
            key={selectedTrigger.id}
            trigger={selectedTrigger}
            instanceName={instanceName}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="p-4 rounded-2xl bg-[#f0f2f5] dark:bg-[#182229]">
              <Zap size={28} className="text-[#aebac1] dark:text-[#667781]" />
            </div>
            <p className="text-sm font-medium text-[#111b21] dark:text-[#e9edef]">Selecione um gatilho</p>
            <p className="text-xs text-[#aebac1] dark:text-[#667781] max-w-[220px]">
              Clique em qualquer gatilho da lista para ver e editar seus detalhes aqui.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

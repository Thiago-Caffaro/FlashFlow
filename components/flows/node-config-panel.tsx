'use client'

import { useEffect, useState } from 'react'
import { X, Zap, AlertCircle, CheckCircle, BookOpen, Plus, Tag, Info, Trash2, Shuffle } from 'lucide-react'
import { FlowNode, FlowNodeData, Trigger, AIProvider, AgentMemoryBlock, SwitchCase, FulfillmentProduct } from '@/types'

// ─── Models per provider ──────────────────────────────────────────────────────

const PROVIDER_MODELS: Record<Exclude<AIProvider, 'openrouter'>, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro'],
  openai: [
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini',
    'gpt-4o', 'gpt-4o-mini',
    'gpt-4-turbo', 'gpt-3.5-turbo',
  ],
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

// ─── AI assistant config sub-component ───────────────────────────────────────

const PROVIDER_DEFAULT_FALLBACK: Record<AIProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o-mini',
}

function AiAssistantConfig({
  node,
  onChange,
  instanceName,
}: {
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
  instanceName: string
}) {
  const { data } = node
  const provider: AIProvider = data.provider ?? 'gemini'
  const useDefaultModel = (data.useDefaultModel as boolean | undefined) !== false
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, { custom_model?: string }>>({})
  const [availableBlocks, setAvailableBlocks] = useState<AgentMemoryBlock[]>([])
  const [showBlockPicker, setShowBlockPicker] = useState(false)

  const attachedIds: string[] = (data.memoryBlockIds as string[] | undefined) ?? []

  useEffect(() => {
    fetch('/api/ai-keys')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setConfiguredKeys(json.configured ?? {})
      })
    fetch(`/api/memory-blocks?instance=${encodeURIComponent(instanceName)}`)
      .then((r) => r.json())
      .then((json) => { if (json.ok) setAvailableBlocks(json.blocks) })
  }, [instanceName])

  const isConfigured = !!configuredKeys[provider]
  const providerDefaultModel = configuredKeys[provider]?.custom_model || PROVIDER_DEFAULT_FALLBACK[provider]

  return (
    <>
      {/* Provider */}
      <div>
        <label className={labelClass}>Provedor de IA</label>
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as AIProvider
            const defaultModel = p === 'gemini' ? 'gemini-2.5-flash' : p === 'openai' ? 'gpt-4o' : ''
            onChange(node.id, { provider: p, model: defaultModel, customModel: '', useDefaultModel: true })
          }}
          className={inputClass}
        >
          {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>
        {/* Configured indicator */}
        <div className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${isConfigured ? 'text-[#00a884]' : 'text-[#aebac1] dark:text-[#667781]'}`}>
          <CheckCircle size={13} />
          {isConfigured ? 'Chave configurada' : 'Chave não configurada — configure em Config. IA'}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className={labelClass}>Modelo</label>

        {/* "Usar modelo padrão" toggle */}
        <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDefaultModel}
            onChange={(e) => onChange(node.id, { useDefaultModel: e.target.checked })}
            className="w-3.5 h-3.5 accent-[#00a884] cursor-pointer"
          />
          <span className="text-xs text-[#54656f] dark:text-[#8696a0]">
            Usar modelo padrão
            {useDefaultModel && (
              <span className="ml-1.5 font-mono text-[#00a884]">{providerDefaultModel}</span>
            )}
          </span>
        </label>

        {!useDefaultModel && (
          provider === 'openrouter' ? (
            <input
              type="text"
              value={data.customModel ?? ''}
              onChange={(e) => onChange(node.id, { customModel: e.target.value })}
              placeholder="ex: mistral/mistral-7b-instruct"
              className={inputClass + ' font-mono'}
            />
          ) : provider === 'openai' ? (
            <>
              <input
                type="text"
                list="node-openai-models-datalist"
                value={data.model ?? PROVIDER_MODELS.openai[0]}
                onChange={(e) => onChange(node.id, { model: e.target.value })}
                placeholder="ex: gpt-4o"
                className={inputClass + ' font-mono'}
              />
              <datalist id="node-openai-models-datalist">
                {PROVIDER_MODELS.openai.map((m) => <option key={m} value={m} />)}
              </datalist>
            </>
          ) : (
            <select
              value={data.model ?? PROVIDER_MODELS[provider as Exclude<AIProvider, 'openrouter'>][0]}
              onChange={(e) => onChange(node.id, { model: e.target.value })}
              className={inputClass}
            >
              {PROVIDER_MODELS[provider as Exclude<AIProvider, 'openrouter'>].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )
        )}
      </div>

      {/* System Prompt */}
      <div>
        <label className={labelClass}>System Prompt</label>
        <textarea
          rows={8}
          value={data.systemPrompt ?? ''}
          onChange={(e) => onChange(node.id, { systemPrompt: e.target.value })}
          placeholder="Você é um atendente da empresa X..."
          className={inputClass}
        />
      </div>

      {/* Temperature */}
      <div>
        <label className={labelClass}>Temperatura</label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={data.temperature ?? 0.7}
          onChange={(e) => onChange(node.id, { temperature: Number(e.target.value) })}
          className={inputClass}
        />
      </div>

      {/* Max tokens */}
      <div>
        <label className={labelClass}>Tamanho máximo da resposta</label>
        <select
          value={data.maxTokens ?? 0}
          onChange={(e) => onChange(node.id, { maxTokens: Number(e.target.value) || undefined })}
          className={inputClass}
        >
          <option value={0}>Sem limite</option>
          <option value={80}>Curta — até 80 tokens (~60 palavras)</option>
          <option value={200}>Média — até 200 tokens (~150 palavras)</option>
          <option value={500}>Longa — até 500 tokens (~375 palavras)</option>
          <option value={1000}>Muito longa — até 1000 tokens (~750 palavras)</option>
        </select>
        <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-1.5">
          Para WhatsApp, respostas curtas ou médias tendem a ter melhor engajamento
        </p>
      </div>

      {/* Memory Blocks */}
      <div className="border-t border-[#f0f2f5] dark:border-[#2a3942] pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-[#667781]" />
            <label className={labelClass + ' mb-0'}>Memória do Agente</label>
          </div>
          <button
            onClick={() => setShowBlockPicker((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] hover:bg-[#00a884] hover:text-white text-xs font-medium transition-colors"
          >
            <Plus size={11} />
            Adicionar
          </button>
        </div>

        {showBlockPicker && (
          <div className="mb-3 border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl overflow-hidden">
            {availableBlocks.length === 0 ? (
              <p className="text-xs text-[#aebac1] p-3">Nenhum bloco criado. Crie em <strong>Memória</strong>.</p>
            ) : (
              availableBlocks
                .filter((b) => !attachedIds.includes(b.id))
                .map((block) => (
                  <button
                    key={block.id}
                    onClick={() => {
                      onChange(node.id, { memoryBlockIds: [...attachedIds, block.id] })
                      setShowBlockPicker(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] border-b border-[#f0f2f5] dark:border-[#2a3942] last:border-0 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-[#111b21] dark:text-[#e9edef] font-medium truncate block">{block.name}</span>
                      {block.type === 'contextual' && block.keywords.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Tag size={9} className="text-amber-500" />
                          <span className="text-[9px] text-[#aebac1]">{block.keywords.slice(0, 3).join(', ')}</span>
                        </div>
                      )}
                    </div>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${block.type === 'always' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}>
                      {block.type === 'always' ? 'Core' : 'Contextual'}
                    </span>
                  </button>
                ))
            )}
          </div>
        )}

        {attachedIds.length === 0 ? (
          <p className="text-xs text-[#aebac1] dark:text-[#667781] leading-relaxed">
            Nenhum bloco anexado. Adicione blocos para dar contexto ao agente.
          </p>
        ) : (
          <div className="space-y-1.5">
            {attachedIds.map((id) => {
              const block = availableBlocks.find((b) => b.id === id)
              return (
                <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate block">
                      {block?.name ?? id}
                    </span>
                    {block?.type === 'contextual' && block.keywords.length > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Tag size={9} className="text-amber-500" />
                        <span className="text-[9px] text-[#aebac1]">{block.keywords.slice(0, 3).join(', ')}</span>
                      </div>
                    )}
                  </div>
                  {block && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${block.type === 'always' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}>
                      {block.type === 'always' ? 'Core' : 'Contextual'}
                    </span>
                  )}
                  <button
                    onClick={() => onChange(node.id, { memoryBlockIds: attachedIds.filter((i) => i !== id) })}
                    className="text-[#aebac1] hover:text-red-500 transition-colors shrink-0"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Continue Conversation */}
      <div className="border-t border-[#f0f2f5] dark:border-[#2a3942] pt-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <div className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={data.continueConversation ?? true}
              onChange={(e) => onChange(node.id, { continueConversation: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-[#d1d7db] dark:bg-[#3d4f5a] rounded-full peer-checked:bg-[#00a884] transition-colors" />
            <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Continuar conversa</span>
            <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-0.5 leading-relaxed">
              A IA responde automaticamente as mensagens seguintes do usuário
            </p>
          </div>
        </label>

        {data.continueConversation && (
          <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-3 pl-3 border-l-2 border-[#00a884]/30">
            Tempo limite, delay e mensagem de encerramento configurados em <strong className="text-[#667781] dark:text-[#8696a0]">Conf. Gerais</strong>.
          </p>
        )}
      </div>
    </>
  )
}

function FulfillmentConfig({ node, onChange }: { node: FlowNode; onChange: (id: string, data: Partial<FlowNodeData>) => void }) {
  const [products, setProducts] = useState<FulfillmentProduct[]>([])
  useEffect(() => {
    fetch('/api/fulfillment/products').then((r) => r.json()).then((json) => { if (json.ok) setProducts(json.products) })
  }, [])
  const requiresProduct = node.type !== 'fulfillmentStatus'
  return (
    <>
      {requiresProduct && (
        <div>
          <label className={labelClass}>Produto do catálogo</label>
          <select value={node.data.productId ?? ''} onChange={(e) => onChange(node.id, { productId: e.target.value, label: products.find((p) => p.id === e.target.value)?.name })} className={inputClass}>
            <option value="">Selecione...</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.country} · {product.name} · {product.sku}</option>)}
          </select>
        </div>
      )}
      <div><label className={labelClass}>Mensagem de sucesso</label><textarea rows={3} value={node.data.successMessage ?? ''} onChange={(e) => onChange(node.id, { successMessage: e.target.value })} className={inputClass} /></div>
      <div><label className={labelClass}>Mensagem de falha</label><textarea rows={3} value={node.data.failureMessage ?? ''} onChange={(e) => onChange(node.id, { failureMessage: e.target.value })} className={inputClass} /></div>
      <p className="text-xs text-[#667781]">Variáveis disponíveis: {'{{contactName}}'}, {'{{contactPhone}}'}, {'{{incomingMessage}}'}, {'{{leadNumber}}'} e {'{{status}}'}.</p>
    </>
  )
}

interface Props {
  node: FlowNode
  flowId: string
  instanceName: string
  onChange: (id: string, data: Partial<FlowNodeData>) => void
  onClose: () => void
}

const inputClass =
  'w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-4 py-3 outline-none focus:border-[#00a884] transition-colors resize-none'

const labelClass = 'text-xs font-semibold text-[#667781] uppercase tracking-wide mb-2 block'

// ─── Start node panel ─────────────────────────────────────────────────────────

function StartNodePanel({
  flowId,
  instanceName,
  node,
  onChange,
}: {
  flowId: string
  instanceName: string
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}) {
  const sessionEndMsg = (node.data.sessionEndMessage as { enabled: boolean; text: string } | undefined) ?? { enabled: false, text: '' }
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/triggers?instance=${encodeURIComponent(instanceName)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          const linked = (json.triggers as Trigger[]).filter(
            (t) => t.action === 'flow' && t.action_payload?.flow_id === flowId
          )
          setTriggers(linked)
        }
      })
      .finally(() => setLoading(false))
  }, [flowId, instanceName])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap size={16} className="text-[#00a884]" />
        <span className={labelClass + ' mb-0'}>Gatilhos vinculados</span>
      </div>

      {loading ? (
        <p className="text-sm text-[#aebac1] dark:text-[#667781]">Carregando...</p>
      ) : triggers.length === 0 ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
          <AlertCircle size={16} className="text-[#aebac1] dark:text-[#667781] shrink-0 mt-0.5" />
          <p className="text-sm text-[#aebac1] dark:text-[#667781] leading-relaxed">
            Nenhum gatilho está ativando este fluxo. Vá em <strong>Gatilhos</strong>, selecione um e mude a ação para <em>Executar fluxo</em>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {triggers.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942] border-l-2 border-[#00a884]"
            >
              <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] truncate">
                {t.alias || <em className="font-normal not-italic text-[#aebac1]">Sem nome</em>}
              </span>
              <span className="text-xs text-[#667781] dark:text-[#8696a0]">
                {t.tipo === 'contains' ? 'Contém' : 'Igual a'}{' '}
                {t.valor
                  ? <span className="font-mono text-[#111b21] dark:text-[#e9edef]">&quot;{t.valor}&quot;</span>
                  : <em className="font-normal not-italic">qualquer msg</em>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Session End Message */}
      <div className="border-t border-[#f0f2f5] dark:border-[#2a3942] pt-4">
        <label className="flex items-start gap-3 cursor-pointer mb-3">
          <div className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={sessionEndMsg.enabled}
              onChange={(e) =>
                onChange(node.id, { sessionEndMessage: { ...sessionEndMsg, enabled: e.target.checked } })
              }
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-[#d1d7db] dark:bg-[#3d4f5a] rounded-full peer-checked:bg-[#00a884] transition-colors" />
            <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Mensagem de encerramento</span>
            <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-0.5 leading-relaxed">
              Enviada automaticamente quando o atendimento de IA terminar
            </p>
          </div>
        </label>
        {sessionEndMsg.enabled && (
          <textarea
            rows={3}
            value={sessionEndMsg.text}
            onChange={(e) =>
              onChange(node.id, { sessionEndMessage: { ...sessionEndMsg, text: e.target.value } })
            }
            placeholder="ex: Atendimento encerrado. Se precisar de ajuda novamente, é só falar!"
            className={inputClass}
          />
        )}
      </div>

      <p className="text-xs text-[#aebac1] dark:text-[#667781] leading-relaxed pt-1">
        Este nó é o ponto de entrada do fluxo e <strong>não pode ser excluído</strong>. Só aceita uma conexão de saída.
      </p>
    </div>
  )
}

// ─── Switch Case config sub-component ────────────────────────────────────────

function SwitchCaseConfig({
  node,
  onChange,
}: {
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}) {
  const cases = ((node.data.cases ?? []) as SwitchCase[])

  function updateCases(next: SwitchCase[]) {
    onChange(node.id, { cases: next })
  }

  function addCase() {
    updateCases([
      ...cases,
      { id: crypto.randomUUID(), conditionType: 'contains', value: '' },
    ])
  }

  function removeCase(id: string) {
    updateCases(cases.filter((c) => c.id !== id))
  }

  function updateCase(id: string, patch: Partial<SwitchCase>) {
    updateCases(cases.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <>
      <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
        <Info size={13} className="text-[#667781] mt-0.5 shrink-0" />
        <p className="text-xs text-[#667781] leading-relaxed">
          Compara a <strong className="text-[#111b21] dark:text-[#e9edef]">mensagem inicial</strong> do cliente com cada Case em ordem. O primeiro que bater é seguido.
        </p>
      </div>

      <div className="space-y-3">
        {cases.length === 0 && (
          <p className="text-xs text-[#aebac1] dark:text-[#667781] italic">Nenhum case adicionado.</p>
        )}
        {cases.map((c, i) => (
          <div key={c.id} className="rounded-xl border border-[#d1d7db] dark:border-[#3d4f5a] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[#f0f2f5] dark:bg-[#2a3942]">
              <div className="flex items-center gap-1.5">
                <Shuffle size={11} className="text-[#3b82f6]" />
                <span className="text-[11px] font-semibold text-[#3b82f6]">Case {i + 1}</span>
              </div>
              <button
                onClick={() => removeCase(c.id)}
                className="p-1 rounded text-[#aebac1] hover:text-red-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <select
                value={c.conditionType}
                onChange={(e) => updateCase(c.id, { conditionType: e.target.value as 'contains' | 'exact' })}
                className={inputClass}
              >
                <option value="contains">Contém</option>
                <option value="exact">Igual a (texto exato)</option>
              </select>
              <input
                type="text"
                value={c.value}
                onChange={(e) => updateCase(c.id, { value: e.target.value })}
                placeholder="Valor a comparar..."
                className={inputClass}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addCase}
        className="flex items-center gap-2 w-full justify-center py-2.5 rounded-xl border-2 border-dashed border-[#3b82f6]/40 text-[#3b82f6] text-sm font-semibold hover:border-[#3b82f6]/80 hover:bg-[#3b82f6]/5 transition-colors"
      >
        <Plus size={15} />
        Adicionar Case
      </button>

      <p className="text-xs text-[#aebac1] dark:text-[#667781] leading-relaxed">
        O caminho <strong className="text-[#9ca3af]">Default</strong> é seguido quando nenhum Case corresponde.
      </p>
    </>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function NodeConfigPanel({ node, flowId, instanceName, onChange, onClose }: Props) {
  const { type, data } = node

  const titles: Record<string, string> = {
    start:        'Início do Fluxo',
    end:          'Fim do Fluxo',
    sendMessage:  'Enviar Mensagem',
    condition:    'Condição',
    switchCase:   'Switch Case',
    aiAssistant:  'Agente',
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[420px] bg-white dark:bg-[#111b21] border-l border-[#f0f2f5] dark:border-[#2a3942] flex flex-col z-10 shadow-xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <span className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">
          {titles[type] ?? 'Configurar nó'}
        </span>
        <button onClick={onClose} className="p-1.5 rounded-lg text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {type === 'start' && (
          <StartNodePanel flowId={flowId} instanceName={instanceName} node={node} onChange={onChange} />
        )}

        {type === 'end' && (
          <p className="text-sm text-[#aebac1] dark:text-[#667781]">Nó de fim do fluxo. Não requer configuração.</p>
        )}

        {type === 'sendMessage' && (
          <div>
            <label className={labelClass}>Mensagem</label>
            <textarea
              rows={8}
              value={data.message ?? ''}
              onChange={(e) => onChange(node.id, { message: e.target.value })}
              placeholder="Digite a mensagem a enviar..."
              className={inputClass}
            />
          </div>
        )}

        {type === 'condition' && (
          <>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942]">
              <Info size={13} className="text-[#667781] mt-0.5 shrink-0" />
              <p className="text-xs text-[#667781] leading-relaxed">
                Este nó compara a <strong className="text-[#111b21] dark:text-[#e9edef]">mensagem inicial</strong> enviada pelo cliente com o valor abaixo.
              </p>
            </div>
            <div>
              <label className={labelClass}>Tipo de comparação</label>
              <select
                value={data.conditionType ?? 'contains'}
                onChange={(e) => onChange(node.id, { conditionType: e.target.value as 'contains' | 'exact' })}
                className={inputClass}
              >
                <option value="contains">Contém</option>
                <option value="exact">Igual a (texto exato)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Valor</label>
              <input
                type="text"
                value={data.conditionValue ?? ''}
                onChange={(e) => onChange(node.id, { conditionValue: e.target.value })}
                placeholder="Texto a comparar..."
                className={inputClass}
              />
            </div>
            <p className="text-xs text-[#aebac1] dark:text-[#667781]">
              Saída <span className="text-[#00a884] font-semibold">Sim</span> = condição verdadeira &nbsp;·&nbsp; Saída <span className="text-red-400 font-semibold">Não</span> = falsa
            </p>
          </>
        )}

        {type === 'switchCase' && (
          <SwitchCaseConfig node={node} onChange={onChange} />
        )}

        {type === 'aiAssistant' && (
          <AiAssistantConfig node={node} onChange={onChange} instanceName={instanceName} />
        )}
        {(type === 'fulfillmentStock' || type === 'fulfillmentStatus') && (
          <FulfillmentConfig node={node} onChange={onChange} />
        )}
      </div>
    </div>
  )
}

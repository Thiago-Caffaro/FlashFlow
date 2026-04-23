'use client'

import { useEffect, useState } from 'react'
import { X, Zap, AlertCircle, CheckCircle } from 'lucide-react'
import { FlowNode, FlowNodeData, Trigger, AIProvider } from '@/types'

// ─── Models per provider ──────────────────────────────────────────────────────

const PROVIDER_MODELS: Record<Exclude<AIProvider, 'openrouter'>, string[]> = {
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

// ─── AI assistant config sub-component ───────────────────────────────────────

function AiAssistantConfig({
  node,
  onChange,
}: {
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
}) {
  const { data } = node
  const provider: AIProvider = data.provider ?? 'gemini'
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/ai-keys')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setConfiguredProviders(Object.keys(json.configured))
      })
  }, [])

  const isConfigured = configuredProviders.includes(provider)

  return (
    <>
      {/* Provider */}
      <div>
        <label className={labelClass}>Provedor de IA</label>
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as AIProvider
            const defaultModel = p === 'gemini' ? 'gemini-2.0-flash' : p === 'openai' ? 'gpt-4o' : ''
            onChange(node.id, { provider: p, model: defaultModel, customModel: '' })
          }}
          className={inputClass}
        >
          {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>
        {/* Configured indicator */}
        <div className={`flex items-center gap-1 mt-1 text-[10px] font-medium ${isConfigured ? 'text-[#00a884]' : 'text-[#aebac1] dark:text-[#667781]'}`}>
          <CheckCircle size={10} />
          {isConfigured ? 'Chave configurada' : 'Chave não configurada — configure em Config. IA'}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className={labelClass}>Modelo</label>
        {provider === 'openrouter' ? (
          <input
            type="text"
            value={data.customModel ?? ''}
            onChange={(e) => onChange(node.id, { customModel: e.target.value })}
            placeholder="ex: mistral/mistral-7b-instruct"
            className={inputClass + ' font-mono'}
          />
        ) : (
          <select
            value={data.model ?? PROVIDER_MODELS[provider][0]}
            onChange={(e) => onChange(node.id, { model: e.target.value })}
            className={inputClass}
          >
            {PROVIDER_MODELS[provider].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>

      {/* System Prompt */}
      <div>
        <label className={labelClass}>System Prompt</label>
        <textarea
          rows={5}
          value={data.systemPrompt ?? ''}
          onChange={(e) => onChange(node.id, { systemPrompt: e.target.value })}
          placeholder="Você é um atendente da empresa X..."
          className={inputClass}
        />
      </div>

      {/* History + Temperature */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Histórico (msgs)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={data.historyLimit ?? 10}
            onChange={(e) => onChange(node.id, { historyLimit: Number(e.target.value) })}
            className={inputClass}
          />
        </div>
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
      </div>
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
  'w-full text-xs text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-2 py-1.5 outline-none focus:border-[#00a884] transition-colors resize-none'

const labelClass = 'text-[10px] font-semibold text-[#667781] uppercase tracking-wide mb-1 block'

// ─── Start node panel ─────────────────────────────────────────────────────────

function StartNodePanel({ flowId, instanceName }: { flowId: string; instanceName: string }) {
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
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Zap size={12} className="text-[#00a884]" />
        <span className={labelClass + ' mb-0'}>Gatilhos vinculados</span>
      </div>

      {loading ? (
        <p className="text-[10px] text-[#aebac1] dark:text-[#667781]">Carregando...</p>
      ) : triggers.length === 0 ? (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942]">
          <AlertCircle size={12} className="text-[#aebac1] dark:text-[#667781] shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#aebac1] dark:text-[#667781] leading-relaxed">
            Nenhum gatilho está ativando este fluxo. Vá em <strong>Gatilhos</strong>, selecione um e mude a ação para <em>Executar fluxo</em>.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {triggers.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942] border-l-2 border-[#00a884]"
            >
              <span className="text-[11px] font-semibold text-[#111b21] dark:text-[#e9edef] truncate">
                {t.alias || <em className="font-normal not-italic text-[#aebac1]">Sem nome</em>}
              </span>
              <span className="text-[10px] text-[#667781] dark:text-[#8696a0]">
                {t.tipo === 'contains' ? 'Contém' : 'Igual a'}{' '}
                {t.valor
                  ? <span className="font-mono text-[#111b21] dark:text-[#e9edef]">&quot;{t.valor}&quot;</span>
                  : <em className="font-normal not-italic">qualquer msg</em>}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-[#aebac1] dark:text-[#667781] leading-relaxed pt-1">
        Este nó é o ponto de entrada do fluxo e <strong>não pode ser excluído</strong>. Só aceita uma conexão de saída.
      </p>
    </div>
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
    aiAssistant:  'IA Assistente',
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-64 bg-white dark:bg-[#111b21] border-l border-[#f0f2f5] dark:border-[#2a3942] flex flex-col z-10 shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <span className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef]">
          {titles[type] ?? 'Configurar nó'}
        </span>
        <button onClick={onClose} className="p-1 rounded text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {type === 'start' && (
          <StartNodePanel flowId={flowId} instanceName={instanceName} />
        )}

        {type === 'end' && (
          <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nó de fim do fluxo. Não requer configuração.</p>
        )}

        {type === 'sendMessage' && (
          <div>
            <label className={labelClass}>Mensagem</label>
            <textarea
              rows={5}
              value={data.message ?? ''}
              onChange={(e) => onChange(node.id, { message: e.target.value })}
              placeholder="Digite a mensagem a enviar..."
              className={inputClass}
            />
          </div>
        )}

        {type === 'condition' && (
          <>
            <div>
              <label className={labelClass}>Tipo de comparação</label>
              <select
                value={data.conditionType ?? 'contains'}
                onChange={(e) => onChange(node.id, { conditionType: e.target.value as 'contains' | 'exact' })}
                className={inputClass}
              >
                <option value="contains">Contém</option>
                <option value="exact">Igual a</option>
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
            <p className="text-[10px] text-[#aebac1] dark:text-[#667781]">
              Saída <span className="text-[#00a884] font-semibold">Sim</span> = verdadeiro &nbsp;·&nbsp; Saída <span className="text-red-400 font-semibold">Não</span> = falso
            </p>
          </>
        )}

        {type === 'aiAssistant' && (
          <AiAssistantConfig node={node} onChange={onChange} />
        )}
      </div>
    </div>
  )
}

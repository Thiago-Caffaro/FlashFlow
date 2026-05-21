'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Trash2, Save, Zap, Bot, Radio, Wrench } from 'lucide-react'

type Provider = 'gemini' | 'openai' | 'openrouter'
type TestState = 'idle' | 'testing' | 'ok' | 'error'
type ModelCheckState = 'idle' | 'checking'

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro']
const OPENAI_MODELS = [
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini',
  'gpt-4o', 'gpt-4o-mini',
  'gpt-4-turbo', 'gpt-3.5-turbo',
]

interface ProviderInfo {
  id: Provider
  label: string
  description: string
  Icon: React.ElementType
  iconColor: string
  keyPlaceholder: string
  keyPrefix: string
  docsUrl: string
  modelOptions?: string[]
  defaultModel: string
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'gemini-2.5-flash, gemini-2.5-pro e outros',
    Icon: Zap,
    iconColor: '#4285f4',
    keyPlaceholder: 'AIzaSy...',
    keyPrefix: 'AIzaSy',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    modelOptions: GEMINI_MODELS,
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o, GPT-4o mini, GPT-4 Turbo e outros',
    Icon: Bot,
    iconColor: '#10a37f',
    keyPlaceholder: 'sk-proj-...',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
    modelOptions: OPENAI_MODELS,
    defaultModel: 'gpt-4o',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Acesso a centenas de modelos com uma única chave',
    Icon: Radio,
    iconColor: '#6366f1',
    keyPlaceholder: 'sk-or-v1-...',
    keyPrefix: 'sk-or-',
    docsUrl: 'https://openrouter.ai/keys',
    modelOptions: undefined,
    defaultModel: 'openai/gpt-4o-mini',
  },
]

interface ConfiguredState {
  [provider: string]: { custom_model?: string; tools_supported?: boolean | null; updated_at: string } | undefined
}

function ToolsSupportedBadge({ value, checking }: { value?: boolean | null; checking: boolean }) {
  if (checking) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-[#667781] dark:text-[#8696a0]">
        <Loader2 size={10} className="animate-spin" />
        Verificando tools...
      </span>
    )
  }
  if (value === true) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
        <Wrench size={10} />
        Function Calling ✓
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
        <Wrench size={10} />
        Sinal de texto (model sem suporte a tools)
      </span>
    )
  }
  return (
    <span className="text-[11px] text-[#aebac1] dark:text-[#667781]">
      Tools: não verificado
    </span>
  )
}

// ─── Individual provider card ─────────────────────────────────────────────────

function ProviderCard({
  info,
  configured,
  onSaved,
  onRemoved,
  onToolsSupported,
}: {
  info: ProviderInfo
  configured?: { custom_model?: string; tools_supported?: boolean | null; updated_at: string }
  onSaved: (toolsSupported: boolean | null) => void
  onRemoved: () => void
  onToolsSupported: (v: boolean | null) => void
}) {
  const [key, setKey] = useState('')
  const [customModel, setCustomModel] = useState(
    configured?.custom_model ?? info.defaultModel
  )
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [modelCheckState, setModelCheckState] = useState<ModelCheckState>('idle')
  const [localToolsSupported, setLocalToolsSupported] = useState<boolean | null | undefined>(
    configured?.tools_supported
  )

  const isSaved = !!configured

  const inputClass =
    'flex-1 bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent focus:border-[#00a884] rounded-xl px-4 py-3 text-sm text-[#111b21] dark:text-[#e9edef] outline-none transition-colors font-mono placeholder:font-sans placeholder:text-[#aebac1] dark:placeholder:text-[#667781]'

  async function handleSave() {
    if (!key.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ai-keys/${info.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim(), customModel: customModel.trim() || undefined }),
      })
      const json = await res.json()
      if (res.ok) {
        setKey('')
        const ts = json.tools_supported ?? null
        setLocalToolsSupported(ts)
        onSaved(ts)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      const res = await fetch(`/api/ai-keys/${info.id}`, { method: 'DELETE' })
      if (res.ok) { setKey(''); setCustomModel(info.defaultModel); setLocalToolsSupported(undefined); onRemoved() }
    } finally {
      setRemoving(false)
    }
  }

  async function handleTest() {
    setTestState('testing')
    setTestMsg('')
    try {
      const res = await fetch(`/api/ai-keys/test/${info.id}`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        setTestState('ok')
        setTestMsg(`Conexão OK · ${json.latency_ms}ms · ${json.model_used}`)
        const ts = json.tools_supported ?? null
        setLocalToolsSupported(ts)
        onToolsSupported(ts)
      } else {
        setTestState('error')
        setTestMsg(json.error ?? 'Erro desconhecido')
      }
    } catch {
      setTestState('error')
      setTestMsg('Erro de rede')
    }
    setTimeout(() => setTestState('idle'), 8000)
  }

  async function handleModelChange(model: string) {
    setCustomModel(model)
    if (!isSaved) return
    setModelCheckState('checking')
    try {
      const res = await fetch(`/api/ai-keys/${info.id}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      const json = await res.json()
      if (json.ok) {
        const ts = json.tools_supported ?? null
        setLocalToolsSupported(ts)
        onToolsSupported(ts)
      }
    } finally {
      setModelCheckState('idle')
    }
  }

  return (
    <div className="rounded-2xl border border-[#f0f2f5] dark:border-[#2a3942] bg-white dark:bg-[#182229] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942]">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: info.iconColor + '18' }}
        >
          <info.Icon size={18} style={{ color: info.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">{info.label}</p>
          <p className="text-xs text-[#aebac1] dark:text-[#667781] truncate">{info.description}</p>
        </div>
        {isSaved ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#00a884] bg-[#e7f8f4] dark:bg-[#0d2e27] px-2.5 py-1 rounded-full shrink-0">
            <CheckCircle size={11} />
            Configurado
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[#aebac1] dark:text-[#667781] bg-[#f0f2f5] dark:bg-[#2a3942] px-2.5 py-1 rounded-full shrink-0">
            Não configurado
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-3">
        {/* Key input */}
        <div>
          <label className="text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide mb-1.5 block">
            {isSaved ? 'Nova chave (deixe vazio para manter a atual)' : 'Chave de API'}
          </label>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={isSaved ? '••••••••••••••••••••' : info.keyPlaceholder}
              className={inputClass}
              onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) handleSave() }}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="px-3 rounded-xl bg-[#f0f2f5] dark:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors shrink-0"
              title={showKey ? 'Ocultar' : 'Mostrar'}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Default model selector */}
        <div>
          <label className="text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide mb-1.5 block">
            Modelo padrão
          </label>
          {info.id === 'openai' ? (
            <>
              <input
                type="text"
                list={`${info.id}-models-datalist`}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                onBlur={(e) => { if (e.target.value.trim() !== (configured?.custom_model ?? info.defaultModel)) handleModelChange(e.target.value.trim()) }}
                placeholder={`ex: ${info.defaultModel}`}
                className={inputClass + ' w-full font-mono'}
                disabled={!isSaved && !key.trim()}
              />
              <datalist id={`${info.id}-models-datalist`}>
                {info.modelOptions!.map((m) => <option key={m} value={m} />)}
              </datalist>
            </>
          ) : info.modelOptions ? (
            <select
              value={customModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className={inputClass + ' w-full cursor-pointer font-sans'}
              disabled={!isSaved && !key.trim()}
            >
              {info.modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onBlur={(e) => { if (e.target.value.trim() !== (configured?.custom_model ?? '')) handleModelChange(e.target.value.trim()) }}
              placeholder={`ex: ${info.defaultModel}`}
              className={inputClass + ' w-full font-mono'}
            />
          )}
          <div className="mt-1.5">
            <ToolsSupportedBadge
              value={localToolsSupported}
              checking={modelCheckState === 'checking'}
            />
          </div>
        </div>

        {/* Test result banner */}
        {testState === 'ok' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#e7f8f4] dark:bg-[#0d2e27] text-xs text-[#00a884] font-medium">
            <CheckCircle size={13} />
            {testMsg}
          </div>
        )}
        {testState === 'error' && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400 font-medium">
            <XCircle size={13} className="shrink-0 mt-0.5" />
            {testMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !key.trim()}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-[#00a884] text-white hover:bg-[#008f72] transition-colors disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>

          {isSaved && (
            <button
              onClick={handleTest}
              disabled={testState === 'testing'}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl border border-[#d1d7db] dark:border-[#3d4f5a] text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors disabled:opacity-50"
            >
              {testState === 'testing' ? (
                <Loader2 size={14} className="animate-spin text-[#00a884]" />
              ) : (
                <Zap size={14} className="text-[#00a884]" />
              )}
              {testState === 'testing' ? 'Testando...' : 'Testar conexão'}
            </button>
          )}

          {isSaved && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="ml-auto flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Remover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function AiSettingsTab() {
  const [configured, setConfigured] = useState<ConfiguredState>({})
  const [loading, setLoading] = useState(true)

  async function fetchConfigured() {
    try {
      const res = await fetch('/api/ai-keys')
      const json = await res.json()
      if (json.ok) setConfigured(json.configured)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchConfigured() }, [])

  function updateToolsSupported(provider: string, ts: boolean | null) {
    setConfigured((prev) => ({
      ...prev,
      [provider]: prev[provider] ? { ...prev[provider]!, tools_supported: ts } : undefined,
    }))
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#f8f9fa] dark:bg-[#0b141a]">
      {/* Header */}
      <div className="px-6 py-5 bg-white dark:bg-[#111b21] border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Provedores de IA</h2>
        <p className="text-xs text-[#aebac1] dark:text-[#667781] mt-0.5">
          As chaves são criptografadas antes de serem salvas. Nunca são expostas na interface.
        </p>
      </div>

      {/* Cards */}
      <div className="flex-1 p-6 space-y-4 max-w-2xl w-full mx-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-[#aebac1]" />
          </div>
        ) : (
          PROVIDERS.map((info) => (
            <ProviderCard
              key={info.id}
              info={info}
              configured={configured[info.id]}
              onSaved={(ts) => {
                fetchConfigured()
                updateToolsSupported(info.id, ts)
              }}
              onRemoved={fetchConfigured}
              onToolsSupported={(ts) => updateToolsSupported(info.id, ts)}
            />
          ))
        )}
      </div>
    </div>
  )
}

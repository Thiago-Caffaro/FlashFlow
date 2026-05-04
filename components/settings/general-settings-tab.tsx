'use client'

import { useEffect, useState } from 'react'
import { Save, Settings2, Loader2, CheckCircle } from 'lucide-react'

interface Config {
  history_limit: number
  timeout_minutes_enabled: boolean
  timeout_minutes: number
  timeout_messages_enabled: boolean
  timeout_messages: number
  response_delay_ms: number
  inactivity_message: string
}

const DEFAULTS: Config = {
  history_limit: 20,
  timeout_minutes_enabled: true,
  timeout_minutes: 360,
  timeout_messages_enabled: false,
  timeout_messages: 50,
  response_delay_ms: 5000,
  inactivity_message: '',
}

const inputClass =
  'w-full text-base text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-5 py-4 outline-none focus:border-[#00a884] transition-colors disabled:opacity-40'

const labelClass = 'text-sm font-semibold text-[#667781] uppercase tracking-wide mb-3 block'

interface Props {
  instanceName: string
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-[#d1d7db] dark:bg-[#3d4f5a] rounded-full peer-checked:bg-[#00a884] transition-colors" />
      <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
    </label>
  )
}

export default function GeneralSettingsTab({ instanceName }: Props) {
  const [cfg, setCfg] = useState<Config>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/instance-ai-config?instance=${encodeURIComponent(instanceName)}`)
      .then((r) => r.json())
      .then((json) => { if (json.ok) setCfg({ ...DEFAULTS, ...json.config }) })
      .finally(() => setLoading(false))
  }, [instanceName])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    await fetch('/api/instance-ai-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: instanceName, ...cfg }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function update(patch: Partial<Config>) {
    setCfg((prev) => ({ ...prev, ...patch }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-[#aebac1]" />
      </div>
    )
  }

  const neitherEnabled = !cfg.timeout_minutes_enabled && !cfg.timeout_messages_enabled

  return (
    <div className="h-full overflow-y-auto bg-[#f0f2f5] dark:bg-[#0b141a]">
      <div className="max-w-2xl mx-auto p-9 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#00a884]/10 flex items-center justify-center">
            <Settings2 size={28} className="text-[#00a884]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">Configurações Gerais</h2>
            <p className="text-sm text-[#aebac1] dark:text-[#667781] mt-0.5">Aplicadas a todos os fluxos desta instância</p>
          </div>
        </div>

        {/* Histórico de mensagens */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl p-7 space-y-5 shadow-sm">
          <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Histórico de mensagens</h3>
          <div>
            <label className={labelClass}>Mensagens no contexto da IA</label>
            <input
              type="number"
              min={1}
              max={100}
              value={cfg.history_limit}
              onChange={(e) => update({ history_limit: Number(e.target.value) })}
              className={inputClass}
            />
            <p className="text-sm text-[#aebac1] dark:text-[#667781] mt-2">
              Quantidade de mensagens anteriores enviadas como contexto para a IA em cada resposta
            </p>
          </div>
        </div>

        {/* Tempo limite de atendimento */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl p-7 space-y-6 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Tempo limite de atendimento</h3>
            <p className="text-sm text-[#aebac1] dark:text-[#667781] mt-1">
              Habilite um ou ambos os limites. Se ambos ativos, o primeiro atingido encerra a sessão.
              {neitherEnabled && <span className="text-amber-500 font-medium"> Nenhum limite ativo — sessões não expiram.</span>}
            </p>
          </div>

          {/* Por minutos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Limite por tempo (minutos)</span>
              <Toggle
                checked={cfg.timeout_minutes_enabled}
                onChange={(v) => update({ timeout_minutes_enabled: v })}
              />
            </div>
            <input
              type="number"
              min={1}
              value={cfg.timeout_minutes}
              disabled={!cfg.timeout_minutes_enabled}
              onChange={(e) => update({ timeout_minutes: Number(e.target.value) })}
              className={inputClass}
            />
            <p className="text-sm text-[#aebac1] dark:text-[#667781]">
              Encerra a sessão após esse tempo sem novo gatilho (360 = 6 horas)
            </p>
          </div>

          {/* Por mensagens */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Limite por mensagens</span>
              <Toggle
                checked={cfg.timeout_messages_enabled}
                onChange={(v) => update({ timeout_messages_enabled: v })}
              />
            </div>
            <input
              type="number"
              min={1}
              value={cfg.timeout_messages}
              disabled={!cfg.timeout_messages_enabled}
              onChange={(e) => update({ timeout_messages: Number(e.target.value) })}
              className={inputClass}
            />
            <p className="text-sm text-[#aebac1] dark:text-[#667781]">
              Encerra a sessão após esse número de respostas da IA
            </p>
          </div>

          <p className="text-sm text-[#aebac1] dark:text-[#667781] pt-1 border-t border-[#f0f2f5] dark:border-[#2a3942]">
            Sessões sem novas mensagens são encerradas automaticamente após <strong className="text-[#667781] dark:text-[#8696a0]">24 horas</strong> de inatividade.
          </p>
        </div>

        {/* Delay da resposta */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl p-7 space-y-5 shadow-sm">
          <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Delay da resposta</h3>
          <div>
            <label className={labelClass}>Aguardar antes de responder</label>
            <select
              value={cfg.response_delay_ms}
              onChange={(e) => update({ response_delay_ms: Number(e.target.value) })}
              className={inputClass}
            >
              <option value={2000}>2 segundos (mínimo)</option>
              <option value={5000}>5 segundos (padrão)</option>
              <option value={10000}>10 segundos</option>
              <option value={15000}>15 segundos</option>
            </select>
            <p className="text-sm text-[#aebac1] dark:text-[#667781] mt-2">
              Aguarda esse tempo após a última mensagem antes de responder — evita múltiplas respostas para mensagens enviadas em sequência
            </p>
          </div>
        </div>

        {/* Mensagem de encerramento */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl p-7 space-y-5 shadow-sm">
          <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Mensagem de encerramento</h3>
          <div>
            <label className={labelClass}>Mensagem enviada ao encerrar sessão por inatividade</label>
            <input
              type="text"
              value={cfg.inactivity_message}
              onChange={(e) => update({ inactivity_message: e.target.value })}
              placeholder="Deixe vazio para encerrar silenciosamente"
              className={inputClass}
            />
            <p className="text-sm text-[#aebac1] dark:text-[#667781] mt-2">
              Enviada quando a sessão expira por inatividade (24 horas). Deixe vazio para não enviar nada.
            </p>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 w-full justify-center py-4 rounded-xl bg-[#00a884] text-white text-base font-semibold hover:bg-[#008f72] disabled:opacity-60 transition-colors shadow-sm"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <CheckCircle size={18} /> : <Save size={18} />}
          {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  )
}

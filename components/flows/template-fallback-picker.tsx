'use client'

import { useMemo } from 'react'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import type { FlowReplyButton } from '@/types'
import { getTemplateQuickReplyButtons } from '@/lib/whatsapp-template-buttons'
import { templateStatusLabel, type TemplateStatus } from '@/lib/whatsapp-template-status'

export interface FallbackTemplateOption {
  id: string
  meta_template_name: string
  language: string
  status: TemplateStatus
  status_reason?: string | null
  body_text: string
  variable_count: number
  buttons?: unknown
}

interface Props {
  templates: FallbackTemplateOption[]
  loading: boolean
  refreshing: boolean
  templateId: string
  variableMap: Record<string, string>
  replyButtons: FlowReplyButton[]
  onChange: (templateId: string, variableMap: Record<string, string>) => void
  onRefresh: () => void
}

const inputClass = 'w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-3 py-2 outline-none focus:border-[#00a884]'

export default function TemplateFallbackPicker({
  templates,
  loading,
  refreshing,
  templateId,
  variableMap,
  replyButtons,
  onChange,
  onRefresh,
}: Props) {
  const selected = useMemo(
    () => templates.find((template) => template.id === templateId && template.status === 'approved') ?? null,
    [templates, templateId]
  )
  const quickReplies = useMemo(() => getTemplateQuickReplyButtons(selected?.buttons), [selected])

  const missingVariable = selected
    ? Array.from({ length: selected.variable_count }, (_, i) => String(i + 1)).find((key) => !variableMap[key]?.trim())
    : undefined

  // Botões do fluxo sem botão de resposta rápida correspondente no template
  // (pareados por posição): o cliente só consegue responder digitando.
  const unmatchedFlowButtons = replyButtons.length - quickReplies.length

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[#d1d7db] dark:border-[#3d4f5a] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Template de fallback</span>
          <p className="text-xs text-[#8696a0]">
            Conta oficial: se o cliente não escreveu nas últimas 24h, esta mensagem sai como o template abaixo e o
            fluxo continua quando ele responder. Dentro da janela, o texto acima é enviado normalmente.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Buscar a lista e o status atual dos templates na Meta"
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] disabled:opacity-60"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#667781] dark:text-[#8696a0]">
          <Loader2 size={14} className="animate-spin" /> Carregando templates...
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-[#8696a0]">
          Nenhum template sincronizado. Crie um no Gerenciador do WhatsApp da Meta e clique em Atualizar.
        </p>
      ) : (
        <select
          value={templateId}
          onChange={(event) => onChange(event.target.value, {})}
          className={inputClass}
        >
          <option value="">Sem template (a mensagem não sai fora da janela de 24h)</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id} disabled={template.status !== 'approved'}>
              {template.meta_template_name} ({template.language})
              {template.status !== 'approved' ? ` — ${templateStatusLabel(template.status, template.status_reason)}` : ''}
            </option>
          ))}
        </select>
      )}

      {templateId && !selected && !loading && (
        <div className="flex items-center gap-2 text-xs text-red-500" role="alert">
          <AlertCircle size={13} />
          O template selecionado não está mais aprovado — escolha outro ou clique em Atualizar.
        </div>
      )}

      {selected && (
        <>
          <div className="text-sm text-[#3b4a54] dark:text-[#d1d7db] bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg p-3 whitespace-pre-wrap">
            {selected.body_text}
          </div>

          {selected.variable_count > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Variáveis do template</span>
              {Array.from({ length: selected.variable_count }, (_, i) => String(i + 1)).map((key) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs text-[#8696a0]">{`{{${key}}}`}</span>
                  <input
                    value={variableMap[key] ?? ''}
                    onChange={(event) => onChange(templateId, { ...variableMap, [key]: event.target.value })}
                    placeholder="Texto literal ou {{variavel}}"
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          )}

          {quickReplies.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Botões do template</span>
              {quickReplies.map((button, position) => (
                <p key={button.index} className="text-xs text-[#3b4a54] dark:text-[#d1d7db]">
                  <span className="font-semibold">{button.text}</span>
                  {' → '}
                  {replyButtons[position]
                    ? <>opção <span className="font-semibold">{replyButtons[position].label || '(sem nome)'}</span> do fluxo</>
                    : <span className="text-[#8696a0]">responde ao cliente e segue para o próximo passo do fluxo</span>}
                </p>
              ))}
            </div>
          )}

          {replyButtons.length > 0 && unmatchedFlowButtons > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400" role="alert">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {quickReplies.length === 0
                ? 'Este template não tem botões de resposta rápida: o cliente precisará digitar a resposta.'
                : `${unmatchedFlowButtons} botão(ões) do fluxo não existem no template: essas opções só funcionam se o cliente digitar.`}
            </div>
          )}

          {missingVariable && (
            <div className="flex items-center gap-2 text-xs text-red-500" role="alert">
              <AlertCircle size={13} />
              {`Preencha o valor de {{${missingVariable}}}`}
            </div>
          )}
        </>
      )}
    </section>
  )
}

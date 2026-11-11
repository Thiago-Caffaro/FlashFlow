// Regras puras das automações simples (sem banco): validação da entrada e o
// fluxo de um envio que cada etapa gera.

import { AUTOMATION_PRESETS, isAutomationKind } from './automation-presets'
import type { AutomationInput, AutomationStepInput, FlowEdge, FlowNode } from '@/types'

export const AUTOMATION_NAME_MAX = 120
export const AUTOMATION_MESSAGE_MAX = 4096
export const AUTOMATION_MAX_DELAY_MINUTES = 7 * 24 * 60

type Parsed<T> = { value: T } | { error: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseVariableMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const map: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{1,2}$/.test(key) || typeof raw !== 'string' || raw.length > 500) return null
    map[key] = raw
  }
  return map
}

function parseStep(raw: unknown, position: number): Parsed<AutomationStepInput> {
  const step = asRecord(raw)
  const delay = Number(step.delay_minutes)
  if (!Number.isInteger(delay) || delay < 1 || delay > AUTOMATION_MAX_DELAY_MINUTES) {
    return { error: `Lembrete ${position}: tempo de espera deve ser entre 1 minuto e 7 dias` }
  }
  const message = typeof step.message === 'string' ? step.message.trim() : ''
  if (!message) return { error: `Lembrete ${position}: mensagem obrigatória` }
  if (message.length > AUTOMATION_MESSAGE_MAX) {
    return { error: `Lembrete ${position}: mensagem com no máximo ${AUTOMATION_MESSAGE_MAX} caracteres` }
  }
  const templateId = typeof step.fallback_template_id === 'string' && step.fallback_template_id.trim()
    ? step.fallback_template_id.trim()
    : null
  const variableMap = parseVariableMap(step.fallback_template_variable_map)
  if (!variableMap) return { error: `Lembrete ${position}: variáveis do template inválidas` }
  return {
    value: {
      delay_minutes: delay,
      message,
      fallback_template_id: templateId,
      fallback_template_variable_map: templateId ? variableMap : {},
    },
  }
}

// Valida e normaliza o corpo de criação/edição de uma automação. Regras que
// dependem do banco (linha, conta, templates) ficam em lib/automations.ts.
export function parseAutomationInput(body: unknown): Parsed<AutomationInput> {
  const input = asRecord(body)
  if (!isAutomationKind(input.kind)) return { error: 'Modelo de automação inválido' }
  const preset = AUTOMATION_PRESETS[input.kind]

  if (input.platform !== 'shopify' && input.platform !== 'lightfunnels') return { error: 'Plataforma inválida' }
  if (!preset.platforms.includes(input.platform)) {
    return { error: `${preset.label} ainda não está disponível para ${input.platform === 'shopify' ? 'Shopify' : 'Lightfunnels'}` }
  }

  const country = String(input.country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'País inválido — use o código de 2 letras (ex: ES)' }

  const productLineId = typeof input.product_line_id === 'string' && input.product_line_id.trim()
    ? input.product_line_id.trim()
    : null

  const instanceName = String(input.instance_name ?? '').trim()
  if (!instanceName) return { error: 'Número de WhatsApp obrigatório' }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return { error: 'Status inválido' }

  const rawSteps = Array.isArray(input.steps) ? input.steps : []
  if (rawSteps.length === 0) return { error: 'Adicione pelo menos um lembrete' }
  if (rawSteps.length > preset.maxSteps) return { error: `No máximo ${preset.maxSteps} lembretes` }
  const steps: AutomationStepInput[] = []
  for (const [index, raw] of rawSteps.entries()) {
    const parsed = parseStep(raw, index + 1)
    if ('error' in parsed) return parsed
    const previous = steps[steps.length - 1]
    if (previous && parsed.value.delay_minutes <= previous.delay_minutes) {
      return { error: `Lembrete ${index + 1}: o tempo de espera deve ser maior que o do lembrete anterior` }
    }
    steps.push(parsed.value)
  }

  const name = String(input.name ?? '').trim() || `${preset.label} ${country}`
  if (name.length > AUTOMATION_NAME_MAX) return { error: `Nome com no máximo ${AUTOMATION_NAME_MAX} caracteres` }

  return {
    value: {
      name,
      kind: input.kind,
      platform: input.platform,
      country,
      product_line_id: productLineId,
      instance_name: instanceName,
      enabled: input.enabled === true,
      steps,
    },
  }
}

// Fluxo de um envio gerado para cada etapa: início → enviar mensagem → fim.
// O template de fallback só entra quando a conta é Cloud API e a janela de
// 24h está fechada — o caso normal de carrinho, que é sempre a empresa
// iniciando a conversa.
export function buildAutomationStepFlowJson(step: AutomationStepInput): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const send: FlowNode = {
    id: 'send',
    type: 'sendMessage',
    position: { x: 0, y: 160 },
    data: {
      label: 'Mensagem',
      message: step.message,
      ...(step.fallback_template_id
        ? {
          fallbackTemplateId: step.fallback_template_id,
          fallbackTemplateVariableMap: step.fallback_template_variable_map,
        }
        : {}),
    },
  }
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Início' } },
      send,
      { id: 'end', type: 'end', position: { x: 0, y: 320 }, data: { label: 'Fim' } },
    ],
    edges: [
      { id: 'start-send', source: 'start', target: 'send' },
      { id: 'send-end', source: 'send', target: 'end' },
    ],
  }
}

export function automationStepFlowName(automationName: string, position: number, totalSteps: number): string {
  return totalSteps > 1 ? `[Automação] ${automationName} · lembrete ${position}` : `[Automação] ${automationName}`
}

// Postgres unique_violation na chave automations_scope_key.
export const DUPLICATE_AUTOMATION_ERROR =
  'Já existe uma automação deste modelo para essa plataforma, país e linha'

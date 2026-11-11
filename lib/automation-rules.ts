// Regras puras das automações simples (sem banco): validação da entrada e o
// fluxo de um envio que cada etapa gera.

import { AUTOMATION_PRESETS, isAutomationKind } from './automation-presets'
import { ISO_TO_FULFILLMENT_COUNTRY } from './fulfillment-countries'
import { AUTOMATION_COUNTRY_ALIASES } from './automation-display'
import { DELIVERY_STATUSES } from '@/types'
import type {
  Automation,
  AutomationConfig,
  AutomationInput,
  AutomationKind,
  AutomationStepInput,
  CatalogPlatform,
  FlowEdge,
  FlowNode,
} from '@/types'

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

function parseStep(raw: unknown, position: number, immediate: boolean): Parsed<AutomationStepInput> {
  const step = asRecord(raw)
  // Modelos sem espera (pedido, entrega, palavra-chave) enviam na hora.
  const delay = immediate ? 0 : Number(step.delay_minutes)
  if (!immediate && (!Number.isInteger(delay) || delay < 1 || delay > AUTOMATION_MAX_DELAY_MINUTES)) {
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

export const AUTOMATION_KEYWORDS_MAX = 500

function parseConfig(kind: AutomationKind, raw: unknown): Parsed<AutomationConfig> {
  const config = asRecord(raw)
  if (kind === 'delivery_status') {
    const statuses = Array.isArray(config.statuses) ? config.statuses : []
    const valid = new Set<string>([...DELIVERY_STATUSES, '*'])
    if (statuses.length === 0) return { error: 'Escolha pelo menos um status de entrega' }
    if (statuses.some((status) => typeof status !== 'string' || !valid.has(status))) {
      return { error: 'Status de entrega inválido' }
    }
    return { value: { statuses: [...new Set(statuses as string[])] } }
  }
  if (kind === 'message_keyword') {
    const keywords = typeof config.keywords === 'string'
      ? config.keywords.split(',').map((word) => word.trim()).filter(Boolean).join(', ')
      : ''
    if (!keywords) return { error: 'Informe pelo menos uma palavra-chave' }
    if (keywords.length > AUTOMATION_KEYWORDS_MAX) return { error: `Palavras-chave com no máximo ${AUTOMATION_KEYWORDS_MAX} caracteres` }
    return { value: { keywords, match: config.match === 'exact' ? 'exact' : 'contains' } }
  }
  return { value: {} }
}

// Valida e normaliza o corpo de criação/edição de uma automação. Regras que
// dependem do banco (linha, conta, templates) ficam em lib/automations.ts.
export function parseAutomationInput(body: unknown): Parsed<AutomationInput> {
  const input = asRecord(body)
  if (!isAutomationKind(input.kind)) return { error: 'Modelo de automação inválido' }
  const preset = AUTOMATION_PRESETS[input.kind]

  let platform: CatalogPlatform | null = null
  let country: string | null = null
  let productLineId: string | null = null
  if (preset.usesOrderScope) {
    if (input.platform !== 'shopify' && input.platform !== 'lightfunnels') return { error: 'Plataforma inválida' }
    if (!preset.platforms.includes(input.platform)) {
      return { error: `${preset.label} ainda não está disponível para ${input.platform === 'shopify' ? 'Shopify' : 'Lightfunnels'}` }
    }
    platform = input.platform
    country = String(input.country ?? '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) return { error: 'País inválido — use o código de 2 letras (ex: ES)' }
    productLineId = typeof input.product_line_id === 'string' && input.product_line_id.trim()
      ? input.product_line_id.trim()
      : null
  }

  const config = parseConfig(input.kind, input.config)
  if ('error' in config) return config

  const instanceName = String(input.instance_name ?? '').trim()
  if (!instanceName) return { error: 'Número de WhatsApp obrigatório' }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return { error: 'Status inválido' }

  const rawSteps = Array.isArray(input.steps) ? input.steps : []
  if (rawSteps.length === 0) return { error: 'Adicione pelo menos um lembrete' }
  if (rawSteps.length > preset.maxSteps) return { error: `No máximo ${preset.maxSteps} lembretes` }
  const steps: AutomationStepInput[] = []
  for (const [index, raw] of rawSteps.entries()) {
    const parsed = parseStep(raw, index + 1, preset.delayLabel === null)
    if ('error' in parsed) return parsed
    const previous = steps[steps.length - 1]
    if (previous && parsed.value.delay_minutes <= previous.delay_minutes) {
      return { error: `Lembrete ${index + 1}: o tempo de espera deve ser maior que o do lembrete anterior` }
    }
    steps.push(parsed.value)
  }

  const name = String(input.name ?? '').trim() || (country ? `${preset.label} ${country}` : preset.label)
  if (name.length > AUTOMATION_NAME_MAX) return { error: `Nome com no máximo ${AUTOMATION_NAME_MAX} caracteres` }

  return {
    value: {
      name,
      kind: input.kind,
      platform,
      country,
      product_line_id: productLineId,
      instance_name: instanceName,
      enabled: input.enabled === true,
      config: config.value,
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

// O carrinho/pedido guarda o país no formato do fulfillment ("SPAIN"); a
// automação guarda o código ISO ("ES"). País sem mapeamento no fulfillment
// fica no código mesmo ou no nome em inglês (ex: Colombia → "CO"/"COLOMBIA").
export function automationMatchesCountry(automationCountry: string | null, orderCountry: string | null | undefined): boolean {
  if (!orderCountry || !automationCountry) return false
  const iso = automationCountry.toUpperCase()
  const order = orderCountry.toUpperCase()
  return order === iso
    || order === (ISO_TO_FULFILLMENT_COUNTRY[iso] ?? iso)
    || (AUTOMATION_COUNTRY_ALIASES[iso] ?? []).includes(order)
}

type ScopedAutomation = Pick<Automation, 'kind' | 'platform' | 'country' | 'product_line_id' | 'enabled'> & {
  config?: AutomationConfig | null
}

// Automação ligada do modelo que atende o carrinho/pedido: mesma plataforma
// e país (e, na entrega, o novo status); a da linha vence a de "qualquer
// linha". Empate (entrega com vários estados) fica com a primeira da lista,
// que vem ordenada por criação.
export function pickScopedAutomation<T extends ScopedAutomation>(
  automations: T[],
  scope: {
    kind: AutomationKind
    platform: CatalogPlatform
    country: string | null | undefined
    productLineId: string | null
    deliveryStatus?: string
  }
): T | null {
  const candidates = automations.filter((automation) => {
    if (!automation.enabled || automation.kind !== scope.kind || automation.platform !== scope.platform) return false
    if (!automationMatchesCountry(automation.country, scope.country)) return false
    if (automation.product_line_id !== null && automation.product_line_id !== scope.productLineId) return false
    if (scope.kind === 'delivery_status') {
      const statuses = automation.config?.statuses ?? []
      return statuses.includes('*') || (scope.deliveryStatus !== undefined && statuses.includes(scope.deliveryStatus))
    }
    return true
  })
  return candidates.find((automation) => automation.product_line_id !== null)
    ?? candidates.find((automation) => automation.product_line_id === null)
    ?? null
}

export function pickCartAutomation<T extends ScopedAutomation>(
  automations: T[],
  cart: { platform: CatalogPlatform; country: string | null | undefined; productLineId: string | null }
): T | null {
  return pickScopedAutomation(automations, { kind: 'abandoned_cart', ...cart })
}

// Mesma regra dos gatilhos de mensagem (lib/message-triggers.ts): lista
// separada por vírgula, '*' casa qualquer texto, 'exact' compara a mensagem
// inteira, sem diferenciar maiúsculas.
export function messageMatchesKeywords(config: AutomationConfig | null | undefined, message: string): boolean {
  const words = (config?.keywords ?? '').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean)
  if (words.length === 0) return false
  if (words.includes('*')) return true
  const content = message.trim().toLowerCase()
  return words.some((word) => (config?.match === 'exact' ? content === word : content.includes(word)))
}

// Gatilho (dedupe) do job de um lembrete: estável enquanto a automação e a
// posição do lembrete não mudam, para o reagendamento empurrar o mesmo job.
export const AUTOMATION_TRIGGER_PREFIX = 'automation:'
export function automationStepTriggerId(automationId: string, position: number): string {
  return `${AUTOMATION_TRIGGER_PREFIX}${automationId}:${position}`
}

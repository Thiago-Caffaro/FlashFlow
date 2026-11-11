import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { validateFlowMessagePlaceholders } from './flow-validation'
import {
  automationStepFlowName,
  buildAutomationStepFlowJson,
  DUPLICATE_AUTOMATION_ERROR,
} from './automation-rules'
import { AUTOMATION_PRESETS } from './automation-presets'
import type { Automation, AutomationInput, AutomationStep, AutomationStepInput, AutomationWithSteps } from '@/types'

// Erro de regra de negócio, com o status HTTP que a rota deve devolver.
export class AutomationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'AutomationError'
  }
}

// Confere o que depende do banco e devolve as etapas normalizadas:
// linha existente; número existente e fora do sandbox; em conta Cloud API,
// todo lembrete com template aprovado da própria conta quando a empresa é
// quem inicia a conversa (carrinho, pedido, entrega — não na resposta por
// palavra-chave). Em conta Evolution o template é descartado.
async function validateReferences(input: AutomationInput): Promise<AutomationStepInput[]> {
  if (input.product_line_id) {
    const { data, error } = await supabaseAdmin
      .from('product_lines')
      .select('id')
      .eq('id', input.product_line_id)
      .maybeSingle()
    if (error) throw new Error(`Falha ao consultar linha de produto: ${error.message}`)
    if (!data) throw new AutomationError('Linha de produto não encontrada', 404)
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, is_sandbox, provider')
    .eq('instance_name', input.instance_name)
    .maybeSingle()
  if (accountError) throw new Error(`Falha ao consultar conta WhatsApp: ${accountError.message}`)
  if (!account || account.is_sandbox === true) throw new AutomationError('Número de WhatsApp inválido', 400)

  // Mesma checagem de variáveis do editor de fluxo: {{chave}} desconhecida
  // sairia literal para o cliente. Variáveis personalizadas são por conta.
  const { data: variables, error: variablesError } = await supabaseAdmin
    .from('message_variables')
    .select('key')
    .eq('instance_name', input.instance_name)
  if (variablesError) throw new Error(`Falha ao consultar variáveis: ${variablesError.message}`)
  const customKeys = (variables ?? []).map((variable) => String(variable.key))
  for (const [index, step] of input.steps.entries()) {
    const check = validateFlowMessagePlaceholders(buildAutomationStepFlowJson(step), customKeys)
    if (!check.ok) throw new AutomationError(`Lembrete ${index + 1}: ${check.error}`, 400)
  }

  if (account.provider !== 'cloud_api') {
    return input.steps.map((step) => ({ ...step, fallback_template_id: null, fallback_template_variable_map: {} }))
  }
  // Resposta por palavra-chave: o cliente acabou de escrever (janela de 24h
  // aberta), então o template é opcional — só os escolhidos são conferidos.
  const templateRequired = AUTOMATION_PRESETS[input.kind].requiresTemplateOnCloudApi
  const missing = input.steps.findIndex((step) => !step.fallback_template_id)
  if (templateRequired && missing >= 0) {
    throw new AutomationError(
      `Lembrete ${missing + 1}: escolha um template aprovado — no número oficial a primeira mensagem para o cliente precisa ser template`,
      400
    )
  }
  const withTemplate = input.steps.filter((step) => step.fallback_template_id)
  if (withTemplate.length === 0) return input.steps
  const templateIds = [...new Set(input.steps.map((step) => String(step.fallback_template_id)))]
  const { data: templates, error: templateError } = await supabaseAdmin
    .from('whatsapp_message_templates')
    .select('id, instance_name, status')
    .in('id', templateIds)
  if (templateError) throw new Error(`Falha ao consultar templates: ${templateError.message}`)
  const usable = new Set(
    (templates ?? [])
      .filter((template) => template.instance_name === input.instance_name && template.status === 'approved')
      .map((template) => String(template.id))
  )
  const invalid = input.steps.findIndex((step) => step.fallback_template_id && !usable.has(String(step.fallback_template_id)))
  if (invalid >= 0) {
    throw new AutomationError(`Lembrete ${invalid + 1}: o template precisa ser aprovado e deste número`, 400)
  }
  return input.steps
}

// Cria/atualiza o fluxo gerado de cada etapa e as etapas em si; etapas que
// sobraram (lista encurtada) são apagadas junto com o fluxo delas.
async function syncSteps(automation: Automation, steps: AutomationStepInput[]): Promise<void> {
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automation.id)
  if (existingError) throw new Error(`Falha ao consultar lembretes: ${existingError.message}`)
  const existing = (existingRows ?? []) as AutomationStep[]
  const byPosition = new Map(existing.map((step) => [step.position, step]))
  const now = new Date().toISOString()

  for (const [index, step] of steps.entries()) {
    const position = index + 1
    const json = buildAutomationStepFlowJson(step)
    const name = automationStepFlowName(automation.name, position, steps.length)
    let flowId = byPosition.get(position)?.flow_id ?? null

    if (flowId) {
      // Só mexe no fluxo enquanto ele ainda pertence à automação.
      const { data: updated, error } = await supabaseAdmin
        .from('flows')
        .update({ json, name, instance_name: automation.instance_name, ativo: true, updated_at: now })
        .eq('id', flowId)
        .eq('managed_by_automation_id', automation.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(`Falha ao atualizar fluxo da automação: ${error.message}`)
      if (!updated) flowId = null
    }
    if (!flowId) {
      const { data: created, error } = await supabaseAdmin
        .from('flows')
        .insert({ instance_name: automation.instance_name, name, json, ativo: true, managed_by_automation_id: automation.id })
        .select('id')
        .single()
      if (error || !created) throw new Error(`Falha ao criar fluxo da automação: ${error?.message ?? 'sem retorno'}`)
      flowId = String(created.id)
    }

    const { error: stepError } = await supabaseAdmin
      .from('automation_steps')
      .upsert({
        automation_id: automation.id,
        position,
        delay_minutes: step.delay_minutes,
        message: step.message,
        fallback_template_id: step.fallback_template_id,
        fallback_template_variable_map: step.fallback_template_variable_map,
        flow_id: flowId,
        updated_at: now,
      }, { onConflict: 'automation_id,position' })
    if (stepError) throw new Error(`Falha ao salvar lembrete ${position}: ${stepError.message}`)
  }

  const removed = existing.filter((step) => step.position > steps.length)
  if (removed.length === 0) return
  const removedFlowIds = removed.map((step) => step.flow_id).filter((id): id is string => Boolean(id))
  if (removedFlowIds.length > 0) {
    const { error } = await supabaseAdmin
      .from('flows')
      .delete()
      .in('id', removedFlowIds)
      .eq('managed_by_automation_id', automation.id)
    if (error) throw new Error(`Falha ao apagar fluxo de lembrete removido: ${error.message}`)
  }
  const { error: deleteError } = await supabaseAdmin
    .from('automation_steps')
    .delete()
    .in('id', removed.map((step) => step.id))
  if (deleteError) throw new Error(`Falha ao apagar lembrete removido: ${deleteError.message}`)
}

function automationRow(input: AutomationInput) {
  return {
    name: input.name,
    kind: input.kind,
    platform: input.platform,
    country: input.country,
    product_line_id: input.product_line_id,
    instance_name: input.instance_name,
    enabled: input.enabled,
    config: input.config,
  }
}

export async function listAutomations(): Promise<AutomationWithSteps[]> {
  const [automations, steps] = await Promise.all([
    supabaseAdmin.from('automations').select('*').order('created_at'),
    supabaseAdmin.from('automation_steps').select('*').order('position'),
  ])
  if (automations.error) throw new Error(`Falha ao consultar automações: ${automations.error.message}`)
  if (steps.error) throw new Error(`Falha ao consultar lembretes: ${steps.error.message}`)
  const allSteps = (steps.data ?? []) as AutomationStep[]
  return ((automations.data ?? []) as Automation[]).map((automation) => ({
    ...automation,
    steps: allSteps.filter((step) => step.automation_id === automation.id),
  }))
}

export async function getAutomation(id: string): Promise<AutomationWithSteps | null> {
  const { data, error } = await supabaseAdmin.from('automations').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Falha ao consultar automação: ${error.message}`)
  if (!data) return null
  const { data: steps, error: stepsError } = await supabaseAdmin
    .from('automation_steps')
    .select('*')
    .eq('automation_id', id)
    .order('position')
  if (stepsError) throw new Error(`Falha ao consultar lembretes: ${stepsError.message}`)
  return { ...(data as Automation), steps: (steps ?? []) as AutomationStep[] }
}

export async function createAutomation(input: AutomationInput): Promise<AutomationWithSteps> {
  const steps = await validateReferences(input)
  const { data, error } = await supabaseAdmin.from('automations').insert(automationRow(input)).select().single()
  if (error?.code === '23505') throw new AutomationError(DUPLICATE_AUTOMATION_ERROR, 409)
  if (error || !data) throw new Error(`Falha ao criar automação: ${error?.message ?? 'sem retorno'}`)

  try {
    await syncSteps(data as Automation, steps)
  } catch (syncError) {
    // Sem transação no supabase-js: desfaz a automação (cascata leva etapas
    // e fluxos já criados) para não sobrar uma automação pela metade.
    await supabaseAdmin.from('automations').delete().eq('id', data.id)
    throw syncError
  }
  const created = await getAutomation(String(data.id))
  if (!created) throw new Error('Automação criada não encontrada')
  return created
}

export async function updateAutomation(id: string, input: AutomationInput): Promise<AutomationWithSteps> {
  const current = await getAutomation(id)
  if (!current) throw new AutomationError('Automação não encontrada', 404)
  if (current.kind !== input.kind) throw new AutomationError('O modelo de uma automação não pode ser trocado', 400)
  const steps = await validateReferences(input)

  const { data, error } = await supabaseAdmin
    .from('automations')
    .update({ ...automationRow(input), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error?.code === '23505') throw new AutomationError(DUPLICATE_AUTOMATION_ERROR, 409)
  if (error || !data) throw new Error(`Falha ao atualizar automação: ${error?.message ?? 'sem retorno'}`)

  await syncSteps(data as Automation, steps)
  const updated = await getAutomation(id)
  if (!updated) throw new AutomationError('Automação não encontrada', 404)
  return updated
}

// Ligar/desligar sem reenviar o formulário inteiro (botão do card). Ligar
// revalida as referências: um template pode ter sido rejeitado depois.
export async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationWithSteps> {
  const current = await getAutomation(id)
  if (!current) throw new AutomationError('Automação não encontrada', 404)
  if (enabled) {
    await validateReferences({
      ...current,
      steps: current.steps.map((step) => ({
        delay_minutes: step.delay_minutes,
        message: step.message,
        fallback_template_id: step.fallback_template_id,
        fallback_template_variable_map: step.fallback_template_variable_map ?? {},
      })),
    })
  }
  const { error } = await supabaseAdmin
    .from('automations')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Falha ao atualizar automação: ${error.message}`)
  return { ...current, enabled }
}

// Cascata: etapas, fluxos gerados e jobs pendentes desses fluxos.
export async function deleteAutomation(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('automations').delete().eq('id', id).select('id').maybeSingle()
  if (error) throw new Error(`Falha ao apagar automação: ${error.message}`)
  return Boolean(data)
}

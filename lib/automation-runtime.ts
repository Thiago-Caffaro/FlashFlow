import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { resolveShopifyCartProductLine } from './product-lines'
import { pickCartAutomation } from './automation-rules'
import type { Automation, AutomationStep, AutomationWithSteps } from '@/types'

// Execução das automações simples nos eventos (hoje: carrinho abandonado
// Shopify). Separado de lib/automations.ts, que é o CRUD do painel.

export type CartAutomationMatch = {
  automation: AutomationWithSteps
  productLineId: string | null
}

// Automação ligada que atende este carrinho Shopify (país + linha dos
// produtos vinculados), com os lembretes que já têm fluxo gerado.
export async function findShopifyCartAutomation(input: {
  integrationId: string
  country: string | null
  payload: unknown
}): Promise<CartAutomationMatch | null> {
  const { data, error } = await supabaseAdmin
    .from('automations')
    .select('*')
    .eq('kind', 'abandoned_cart')
    .eq('platform', 'shopify')
    .eq('enabled', true)
  if (error) throw new Error(`Falha ao consultar automações: ${error.message}`)
  const automations = (data ?? []) as Automation[]
  if (automations.length === 0) return null

  // Só resolve a linha (3 consultas) quando há automação ligada.
  const line = await resolveShopifyCartProductLine(input.integrationId, input.payload)
  const productLineId = line?.id ?? null
  const automation = pickCartAutomation(automations, { platform: 'shopify', country: input.country, productLineId })
  if (!automation) return null

  const { data: steps, error: stepsError } = await supabaseAdmin
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automation.id)
    .order('position')
  if (stepsError) throw new Error(`Falha ao consultar lembretes da automação: ${stepsError.message}`)
  return {
    automation: { ...automation, steps: ((steps ?? []) as AutomationStep[]).filter((step) => Boolean(step.flow_id)) },
    productLineId,
  }
}

// Número pelo qual o lembrete sai, lido na hora do envio: desligar a
// automação para os lembretes pendentes, e trocar o número leva os pendentes
// para o número novo. null = automação desligada ou apagada.
export async function getEnabledAutomationInstance(automationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('automations')
    .select('instance_name, enabled')
    .eq('id', automationId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar automação: ${error.message}`)
  if (!data || data.enabled !== true) return null
  return String(data.instance_name)
}

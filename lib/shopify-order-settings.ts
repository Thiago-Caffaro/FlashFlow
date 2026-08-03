import 'server-only'
import { deleteSetting, getSetting, setSetting } from './app-settings'
import { supabaseAdmin } from './supabase-admin'

export const SHOPIFY_DEFAULT_ORDER_INSTANCE_KEY = 'shopify_default_order_instance'

export async function getDefaultShopifyOrderInstance(): Promise<string | null> {
  const stored = (await getSetting(SHOPIFY_DEFAULT_ORDER_INSTANCE_KEY))?.trim()
  if (!stored) return null

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, is_sandbox')
    .eq('instance_name', stored)
    .maybeSingle()

  if (error) throw new Error(`Falha ao validar conta padrao: ${error.message}`)
  if (!data || data.is_sandbox === true) return null
  return String(data.instance_name)
}

export async function setDefaultShopifyOrderInstance(instanceName: string | null): Promise<string | null> {
  const normalized = instanceName?.trim() ?? ''
  if (!normalized) {
    await deleteSetting(SHOPIFY_DEFAULT_ORDER_INSTANCE_KEY)
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, is_sandbox')
    .eq('instance_name', normalized)
    .maybeSingle()

  if (error) throw new Error(`Falha ao validar conta WhatsApp: ${error.message}`)
  if (!data) throw new Error('Conta WhatsApp nao encontrada')
  if (data.is_sandbox === true) throw new Error('A conta Sandbox nao pode ser usada como conta padrao')

  await setSetting(SHOPIFY_DEFAULT_ORDER_INSTANCE_KEY, normalized)
  return normalized
}

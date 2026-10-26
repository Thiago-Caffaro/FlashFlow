import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getDefaultShopifyOrderInstance } from './shopify-order-settings'
import { pickShopifyStoreAccount } from './shopify-store-accounts'
import { pickLightfunnelsStoreAccount } from './lightfunnels-store-accounts'

// Qual conta WhatsApp recebe um pedido, para qualquer plataforma de
// e-commerce. Ordem: contas vinculadas à loja/conta da plataforma (quando
// houver alguma utilizável) → conta padrão global de pedidos → país +
// prioridade entre todas as contas com confirmação ligada.

export type OrderRoutingSource =
  | { platform: 'shopify'; integrationId: string }
  | { platform: 'lightfunnels'; integrationId: string; funnelId?: string | null }

// `source` como string é o formato antigo (id de loja Shopify) — mantido
// para quem já chama assignConfirmationAccount(country, integrationId).
export async function assignConfirmationAccount(
  country: string,
  source?: string | OrderRoutingSource
): Promise<string | null> {
  const routing: OrderRoutingSource | undefined = typeof source === 'string'
    ? { platform: 'shopify', integrationId: source }
    : source

  if (routing?.platform === 'shopify' && routing.integrationId) {
    const storeInstanceName = await pickShopifyStoreAccount(routing.integrationId, country)
    if (storeInstanceName) return storeInstanceName
  }
  if (routing?.platform === 'lightfunnels' && routing.integrationId) {
    const linkedInstanceName = await pickLightfunnelsStoreAccount(routing.integrationId, country, routing.funnelId ?? null)
    if (linkedInstanceName) return linkedInstanceName
  }

  const defaultInstanceName = await getDefaultShopifyOrderInstance()
  if (defaultInstanceName) return defaultInstanceName

  const normalizedCountry = country.trim().toUpperCase()
  if (!normalizedCountry) return null
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name')
    .eq('country', normalizedCountry)
    .eq('confirmation_enabled', true)
    .order('confirmation_priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Falha ao selecionar conta WhatsApp: ${error.message}`)
  return typeof data?.instance_name === 'string' ? data.instance_name : null
}

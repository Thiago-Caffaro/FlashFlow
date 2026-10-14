import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import type { ShopifyStoreAccountLink } from '@/types'

// Contas WhatsApp vinculadas a uma loja Shopify (migration 026). Loja sem
// vínculo segue a regra geral de assignConfirmationAccount (conta padrão ou
// país + prioridade).

export async function listShopifyStoreAccounts(integrationId: string): Promise<ShopifyStoreAccountLink[]> {
  const { data, error } = await supabaseAdmin
    .from('shopify_integration_accounts')
    .select('instance_name, priority, enabled')
    .eq('integration_id', integrationId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Falha ao listar contas da loja: ${error.message}`)
  return (data ?? []).map((row) => ({
    instance_name: String(row.instance_name),
    priority: Number(row.priority ?? 100),
    enabled: row.enabled !== false,
  }))
}

// Substitui todos os vínculos da loja pela lista recebida.
export async function replaceShopifyStoreAccounts(
  integrationId: string,
  links: ShopifyStoreAccountLink[]
): Promise<ShopifyStoreAccountLink[]> {
  const names = [...new Set(links.map((link) => link.instance_name))]
  if (names.length > 0) {
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('accounts')
      .select('instance_name, is_sandbox')
      .in('instance_name', names)
    if (accountsError) throw new Error(`Falha ao validar contas WhatsApp: ${accountsError.message}`)
    const valid = new Set((accounts ?? []).filter((a) => a.is_sandbox !== true).map((a) => String(a.instance_name)))
    const invalid = names.filter((name) => !valid.has(name))
    if (invalid.length > 0) throw new Error(`Conta WhatsApp inválida: ${invalid.join(', ')}`)
  }

  const { error: deleteError } = await supabaseAdmin
    .from('shopify_integration_accounts')
    .delete()
    .eq('integration_id', integrationId)
  if (deleteError) throw new Error(`Falha ao atualizar contas da loja: ${deleteError.message}`)

  const byName = new Map(links.map((link) => [link.instance_name, link]))
  if (byName.size > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('shopify_integration_accounts')
      .insert([...byName.values()].map((link) => ({
        integration_id: integrationId,
        instance_name: link.instance_name,
        priority: Number.isFinite(link.priority) ? Math.max(0, Math.round(link.priority)) : 100,
        enabled: link.enabled !== false,
      })))
    if (insertError) throw new Error(`Falha ao salvar contas da loja: ${insertError.message}`)
  }
  return listShopifyStoreAccounts(integrationId)
}

// Conta da loja para um pedido/carrinho: entre as contas vinculadas e ativas,
// a do país do pedido vem primeiro; empate (ou nenhuma do país) decide pela
// prioridade. null = loja sem conta utilizável → regra geral.
export async function pickShopifyStoreAccount(integrationId: string, country: string): Promise<string | null> {
  const links = (await listShopifyStoreAccounts(integrationId)).filter((link) => link.enabled)
  if (links.length === 0) return null

  // Conta apagada ou virada sandbox depois do vínculo não serve.
  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, country, is_sandbox')
    .in('instance_name', links.map((link) => link.instance_name))
  if (error) throw new Error(`Falha ao carregar contas da loja: ${error.message}`)
  const countryByName = new Map(
    (accounts ?? [])
      .filter((account) => account.is_sandbox !== true)
      .map((account) => [String(account.instance_name), String(account.country ?? '').trim().toUpperCase()])
  )
  const usable = links.filter((link) => countryByName.has(link.instance_name))
  if (usable.length === 0) return null

  const normalizedCountry = country.trim().toUpperCase()
  const sameCountry = normalizedCountry
    ? usable.find((link) => countryByName.get(link.instance_name) === normalizedCountry)
    : undefined
  return (sameCountry ?? usable[0]).instance_name
}

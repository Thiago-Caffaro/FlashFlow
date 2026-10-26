import 'server-only'
import { supabaseAdmin } from './supabase-admin'

// Escolha da conta WhatsApp entre os vínculos de uma loja/conta de
// e-commerce (Shopify: shopify_integration_accounts; Lightfunnels:
// lightfunnels_integration_accounts).

export interface LinkedAccountCandidate {
  instance_name: string
  enabled: boolean
}

// Entre os vínculos ativos, a conta do país do pedido vem primeiro; empate
// (ou nenhuma do país) decide pela ordem recebida (já ordenada por
// prioridade). Conta apagada ou virada sandbox depois do vínculo não serve.
// null = nenhum vínculo utilizável → regra geral.
export async function pickLinkedAccount(links: LinkedAccountCandidate[], country: string): Promise<string | null> {
  const enabled = links.filter((link) => link.enabled)
  if (enabled.length === 0) return null

  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, country, is_sandbox')
    .in('instance_name', enabled.map((link) => link.instance_name))
  if (error) throw new Error(`Falha ao carregar contas da loja: ${error.message}`)
  const countryByName = new Map(
    (accounts ?? [])
      .filter((account) => account.is_sandbox !== true)
      .map((account) => [String(account.instance_name), String(account.country ?? '').trim().toUpperCase()])
  )
  const usable = enabled.filter((link) => countryByName.has(link.instance_name))
  if (usable.length === 0) return null

  const normalizedCountry = country.trim().toUpperCase()
  const sameCountry = normalizedCountry
    ? usable.find((link) => countryByName.get(link.instance_name) === normalizedCountry)
    : undefined
  return (sameCountry ?? usable[0]).instance_name
}

// Valida que todas as contas existem e não são sandbox antes de vincular.
export async function assertLinkableAccounts(names: string[]): Promise<void> {
  if (names.length === 0) return
  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('instance_name, is_sandbox')
    .in('instance_name', names)
  if (error) throw new Error(`Falha ao validar contas WhatsApp: ${error.message}`)
  const valid = new Set((accounts ?? []).filter((a) => a.is_sandbox !== true).map((a) => String(a.instance_name)))
  const invalid = names.filter((name) => !valid.has(name))
  if (invalid.length > 0) throw new Error(`Conta WhatsApp inválida: ${invalid.join(', ')}`)
}

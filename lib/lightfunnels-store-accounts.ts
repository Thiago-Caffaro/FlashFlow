import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { assertLinkableAccounts, pickLinkedAccount } from './store-account-links'
import type { LightfunnelsStoreAccountLink } from '@/types'

// Contas WhatsApp vinculadas a uma conta Lightfunnels (migration 027). Cada
// vínculo pode se restringir a funis: funnel_ids vazio = todos os funis.
// Conta Lightfunnels sem vínculo utilizável segue a regra geral de
// assignConfirmationAccount (conta padrão ou país + prioridade).

const MAX_FUNNELS_PER_LINK = 200

function normalizeFunnelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => String(id ?? '').trim()).filter(Boolean))].slice(0, MAX_FUNNELS_PER_LINK)
}

export async function listLightfunnelsStoreAccounts(integrationId: string): Promise<LightfunnelsStoreAccountLink[]> {
  const { data, error } = await supabaseAdmin
    .from('lightfunnels_integration_accounts')
    .select('instance_name, priority, enabled, funnel_ids')
    .eq('integration_id', integrationId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Falha ao listar contas da integração Lightfunnels: ${error.message}`)
  return (data ?? []).map((row) => ({
    instance_name: String(row.instance_name),
    priority: Number(row.priority ?? 100),
    enabled: row.enabled !== false,
    funnel_ids: normalizeFunnelIds(row.funnel_ids),
  }))
}

// Substitui todos os vínculos da conta Lightfunnels pela lista recebida.
export async function replaceLightfunnelsStoreAccounts(
  integrationId: string,
  links: LightfunnelsStoreAccountLink[]
): Promise<LightfunnelsStoreAccountLink[]> {
  await assertLinkableAccounts([...new Set(links.map((link) => link.instance_name))])

  const { error: deleteError } = await supabaseAdmin
    .from('lightfunnels_integration_accounts')
    .delete()
    .eq('integration_id', integrationId)
  if (deleteError) throw new Error(`Falha ao atualizar contas da integração: ${deleteError.message}`)

  const byName = new Map(links.map((link) => [link.instance_name, link]))
  if (byName.size > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('lightfunnels_integration_accounts')
      .insert([...byName.values()].map((link) => ({
        integration_id: integrationId,
        instance_name: link.instance_name,
        priority: Number.isFinite(link.priority) ? Math.max(0, Math.round(link.priority)) : 100,
        enabled: link.enabled !== false,
        funnel_ids: normalizeFunnelIds(link.funnel_ids),
      })))
    if (insertError) throw new Error(`Falha ao salvar contas da integração: ${insertError.message}`)
  }
  return listLightfunnelsStoreAccounts(integrationId)
}

// Vínculos restritos a funis têm precedência sobre os genéricos ("todos os
// funis"): quem dedicou uma conta a um funil espera que os pedidos dele caiam
// lá, mesmo que uma conta genérica tenha prioridade maior. Se nenhum
// dedicado estiver utilizável, cai para os genéricos. Pedido sem funil
// conhecido (ex: backfill pela API, que não expõe funnel_id) só casa com os
// genéricos.
export async function pickLightfunnelsStoreAccount(
  integrationId: string,
  country: string,
  funnelId: string | null
): Promise<string | null> {
  const links = await listLightfunnelsStoreAccounts(integrationId)
  const enabled = links.filter((link) => link.enabled)
  const specific = funnelId ? enabled.filter((link) => link.funnel_ids.includes(funnelId)) : []
  if (specific.length > 0) {
    const picked = await pickLinkedAccount(specific, country)
    if (picked) return picked
  }
  return pickLinkedAccount(enabled.filter((link) => link.funnel_ids.length === 0), country)
}

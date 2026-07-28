import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Confirma que um recurso identificado por `id` pertence a `instanceName`,
 * consultando o valor real armazenado (nunca confiando em instance_name vindo
 * do cliente sem cruzar contra o registro). Retorna o valor de
 * `instanceColumn` da linha encontrada, ou `null` se não existir — o chamador
 * decide se compara e responde 404/403.
 */
export async function fetchOwningInstance(
  supabase: SupabaseClient,
  table: string,
  id: string,
  instanceColumn = 'instance_name'
): Promise<string | null> {
  const { data } = await supabase.from(table).select(instanceColumn).eq('id', id).maybeSingle()
  if (!data) return null
  const value = (data as unknown as Record<string, unknown>)[instanceColumn]
  return typeof value === 'string' ? value : null
}

/**
 * Verifica que `id` pertence a `expectedInstance`. Retorna true apenas
 * quando o recurso existe e o instance_name armazenado bate exatamente com
 * o esperado.
 */
export async function belongsToInstance(
  supabase: SupabaseClient,
  table: string,
  id: string,
  expectedInstance: string,
  instanceColumn = 'instance_name'
): Promise<boolean> {
  const actual = await fetchOwningInstance(supabase, table, id, instanceColumn)
  return actual !== null && actual === expectedInstance
}

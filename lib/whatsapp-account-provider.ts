import 'server-only'
import type { WhatsAppProvider } from '@/types'
import { supabaseAdmin } from './supabase-admin'

/**
 * Resolve qual provedor de WhatsApp uma conta usa. Ponto único de checagem —
 * dispatcher, adapters e rotas sempre chamam isto em vez de reimplementar a
 * comparação (o que aconteceria de forma espalhada, como já ocorre com
 * SANDBOX_INSTANCE_NAME em lib/sandbox.ts).
 *
 * Se a coluna accounts.provider ainda não existir (deploy anterior à
 * migration) ou a conta não for encontrada, assume 'evolution' — todas as
 * contas eram Evolution antes desta coluna existir.
 */
export async function getAccountProvider(instanceName: string): Promise<WhatsAppProvider> {
  const { data } = await supabaseAdmin
    .from('accounts')
    .select('provider')
    .eq('instance_name', instanceName)
    .maybeSingle()

  return data?.provider === 'cloud_api' ? 'cloud_api' : 'evolution'
}

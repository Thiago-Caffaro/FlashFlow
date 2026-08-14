import { NextRequest, NextResponse } from 'next/server'
import { getEvolutionConnectionState, setEvolutionWebhook } from '@/lib/evolution-api'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// GET /api/accounts/[name]/status — estado de conexão da instância
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  // Contas Cloud API não têm instância na Evolution para consultar — o
  // estado vem de whatsapp_cloud_credentials (mesma lógica de GET /api/accounts).
  const { data: account } = await supabaseAdmin
    .from('accounts')
    .select('provider')
    .eq('instance_name', name)
    .maybeSingle()
  if (account?.provider === 'cloud_api') {
    const { data: cred } = await supabaseAdmin
      .from('whatsapp_cloud_credentials')
      .select('display_phone_number, verified_name, last_verified_at, last_error')
      .eq('instance_name', name)
      .maybeSingle()
    return NextResponse.json({
      state: cred?.last_verified_at && !cred.last_error ? 'open' : 'close',
      profileName: cred?.verified_name ?? null,
      profilePicUrl: null,
      phone: cred?.display_phone_number ?? null,
    })
  }

  try {
    const current = await getEvolutionConnectionState(name)
    if (current.state === 'open') {
      void setEvolutionWebhook(name).catch((err) => {
        console.error(`[status] setEvolutionWebhook("${name}") falhou:`, err instanceof Error ? err.message : err)
      })
    }

    return NextResponse.json(current)
  } catch {
    return NextResponse.json({ state: 'close' })
  }
}

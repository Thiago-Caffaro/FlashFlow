import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getQr } from '@/lib/qr-cache'
import { getWebhookLogs } from '@/lib/webhook-log'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

export async function GET() {
  // Instâncias do banco
  const { data: stored } = await supabase
    .from('accounts')
    .select('instance_name, label')
    .order('created_at', { ascending: true })

  const accounts = stored ?? []
  const instanceNames = accounts.map((a) => a.instance_name)

  // Estado live de cada instância
  const instanceStates: Record<string, unknown> = {}
  await Promise.all(
    instanceNames.map(async (name) => {
      try {
        const r = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${name}`, {
          headers: { apikey: EVOLUTION_API_KEY },
        })
        instanceStates[name] = r.ok ? await r.json() : { error: `HTTP ${r.status}` }
      } catch (e) {
        instanceStates[name] = { error: (e as Error).message }
      }
    })
  )

  // Quais instâncias têm QR em cache
  const qrCacheKeys = instanceNames.filter((n) => getQr(n) !== null)

  // Últimos 30 webhooks recebidos
  const recentWebhooks = getWebhookLogs()

  // Últimas 10 mensagens do banco
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('id, conversation_id, content, type, direction, status, created_at, wa_message_id')
    .order('created_at', { ascending: false })
    .limit(10)

  // Estado da Evolution API
  let evoStatus: unknown = null
  try {
    const r = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    const raw = r.ok ? await r.json() : null
    const items = Array.isArray(raw) ? raw : (raw?.instances ?? raw?.data ?? [])
    evoStatus = items.map((item: Record<string, unknown>) => {
      const inst = (item?.instance as Record<string, unknown>) ?? item
      return {
        name: inst?.instanceName ?? inst?.name,
        status: inst?.connectionStatus ?? inst?.status,
        profileName: inst?.profileName ?? null,
      }
    })
  } catch (e) {
    evoStatus = { error: (e as Error).message }
  }

  return NextResponse.json({
    ts: new Date().toISOString(),
    accounts,
    instanceStates,
    qrCacheKeys,
    recentWebhooks,
    recentMessages: recentMessages ?? [],
    evoStatus,
  })
}

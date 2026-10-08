import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { EvolutionHistoryError, importEvolutionHistory } from '@/lib/evolution-history'
import { createLogger } from '@/lib/logger'
import { maskJid } from '@/lib/redact'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const log = createLogger('messages-sync')

// Caches instance name → UUID for the server process lifetime.
// Avoids a repeated "Instance" table lookup on every sync call.
const instanceIdCache = new Map<string, string>()

async function getInstanceId(instanceName: string): Promise<string | null> {
  if (instanceIdCache.has(instanceName)) return instanceIdCache.get(instanceName)!

  // Requires: GRANT SELECT ON TABLE public."Instance" TO service_role;
  const { data, error } = await supabase
    .from('Instance')
    .select('id')
    .eq('name', instanceName)
    .maybeSingle()

  if (error) {
    log.warn('falha ao consultar a tabela Instance da Evolution', { instance: instanceName, err: error }, { throttleKey: `instance:${error.code}` })
    return null
  }
  if (data?.id) {
    instanceIdCache.set(instanceName, data.id as string)
    return data.id as string
  }
  log.info('instância não encontrada na tabela Instance da Evolution — nada a sincronizar', { instance: instanceName }, { throttleKey: `instance-missing:${instanceName}` })
  return null
}

// POST /api/messages/sync/[conversationId]
// Reads the last 30 messages directly from Evolution API's Message table in Supabase,
// giving access to the full stored history (not just messages received while the server
// was running).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params
  const instanceParam = req.nextUrl.searchParams.get('instance') ?? ''
  if (!instanceParam) {
    return NextResponse.json({ ok: false, error: 'instance obrigatório' }, { status: 400 })
  }

  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('wa_id, instance_name')
    .eq('id', conversationId)
    .maybeSingle()

  if (convError) log.warn('falha ao carregar conversa para sincronizar', { conversationId, err: convError })
  if (!conv || conv.instance_name !== instanceParam) {
    return NextResponse.json({ ok: false, added: 0 })
  }

  const { wa_id: remoteJid, instance_name: instanceName } = conv

  // Map instance name to the UUID used in the Message table
  const instanceId = await getInstanceId(instanceName)
  if (!instanceId) return NextResponse.json({ ok: true, added: 0 })

  try {
    const result = await importEvolutionHistory({ conversationId, instanceId, remoteJid })
    if (result.found === 0) {
      log.debug('nenhuma mensagem no histórico da Evolution', { conversationId, instance: instanceName, jid: maskJid(remoteJid) })
      return NextResponse.json({ ok: true, added: 0 })
    }
    log.info('histórico sincronizado', {
      conversationId,
      instance: instanceName,
      found: result.found,
      added: result.added,
      ...(result.alreadyElsewhere > 0 ? { alreadyInOtherConversation: result.alreadyElsewhere } : {}),
      ...(result.ignored > 0 ? { ignored: result.ignored } : {}),
      ...(result.unknownFormat > 0 ? { unknownFormat: result.unknownFormat } : {}),
    })
    return NextResponse.json({ ok: true, added: result.added })
  } catch (err) {
    if (err instanceof EvolutionHistoryError) {
      log.error('falha ao sincronizar histórico', { conversationId, instance: instanceName, err })
      return NextResponse.json({ ok: false, added: 0 }, { status: 500 })
    }
    log.error('erro inesperado ao sincronizar mensagens', { conversationId, err })
    return NextResponse.json({ ok: true, added: 0 })
  }
}

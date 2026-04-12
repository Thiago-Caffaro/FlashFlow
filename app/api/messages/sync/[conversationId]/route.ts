import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Caches instance name → UUID for the server process lifetime.
// Avoids a repeated "Instance" table lookup on every sync call.
const instanceIdCache = new Map<string, string>()

const STATUS_MAP: Record<string, string> = {
  READ: 'read',
  PLAYED: 'read',
  DELIVERY_ACK: 'delivered',
  SERVER_ACK: 'sent',
  PENDING: 'sent',
}

interface EvoMessageRow {
  key: { id: string; fromMe: boolean; remoteJid: string }
  message: Record<string, unknown> | null
  messageType: string
  messageTimestamp: number
  status: string | null
}

function extractContent(row: EvoMessageRow): { content: string; type: string } {
  const msg = row.message ?? {}

  switch (row.messageType) {
    case 'conversation':
    case 'extendedTextMessage': {
      const text =
        (msg.conversation as string) ||
        ((msg.extendedTextMessage as { text?: string } | undefined)?.text ?? '')
      return { content: text || '[texto]', type: 'text' }
    }
    case 'imageMessage': {
      const caption =
        (msg.imageMessage as { caption?: string } | undefined)?.caption ?? ''
      return { content: caption || '[imagem]', type: 'image' }
    }
    case 'audioMessage':
    case 'pttMessage':
      return { content: '[áudio]', type: 'audio' }
    case 'videoMessage': {
      const caption = (msg.videoMessage as { caption?: string } | undefined)?.caption ?? ''
      return { content: caption || '[vídeo]', type: 'video' }
    }
    case 'documentMessage': {
      const doc = msg.documentMessage as { title?: string; fileName?: string } | undefined
      return { content: doc?.title ?? doc?.fileName ?? '[documento]', type: 'media' }
    }
    case 'stickerMessage':
      return { content: '[figurinha]', type: 'sticker' }
    default:
      return { content: '[mídia]', type: 'media' }
  }
}

async function getInstanceId(instanceName: string): Promise<string | null> {
  if (instanceIdCache.has(instanceName)) return instanceIdCache.get(instanceName)!

  // Requires: GRANT SELECT ON TABLE public."Instance" TO service_role;
  const { data } = await supabase
    .from('Instance')
    .select('id')
    .eq('name', instanceName)
    .maybeSingle()

  if (data?.id) {
    instanceIdCache.set(instanceName, data.id as string)
    return data.id as string
  }
  return null
}

// POST /api/messages/sync/[conversationId]
// Reads the last 30 messages directly from Evolution API's Message table in Supabase,
// giving access to the full stored history (not just messages received while the server
// was running).
//
// Requires:
//   GRANT SELECT ON TABLE public."Message"  TO service_role;
//   GRANT SELECT ON TABLE public."Instance" TO service_role;
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params

  const { data: conv } = await supabase
    .from('conversations')
    .select('wa_id, instance_name')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv) return NextResponse.json({ ok: false, added: 0 })

  const { wa_id: remoteJid, instance_name: instanceName } = conv

  // Map instance name to the UUID used in the Message table
  const instanceId = await getInstanceId(instanceName)
  if (!instanceId) return NextResponse.json({ ok: true, added: 0 })

  try {
    const { data: evoMessages, error } = await supabase
      .from('Message')
      .select('key, message, messageType, messageTimestamp, status')
      .eq('instanceId', instanceId)
      .filter('key->>remoteJid', 'eq', remoteJid)
      .order('messageTimestamp', { ascending: false })
      .limit(30)

    if (error || !evoMessages?.length) return NextResponse.json({ ok: true, added: 0 })

    // Deduplicate against messages already stored for this conversation
    const waIds = evoMessages
      .map((m) => (m.key as { id?: string })?.id)
      .filter(Boolean) as string[]

    const { data: existing } = await supabase
      .from('messages')
      .select('wa_message_id')
      .eq('conversation_id', conversationId)
      .in('wa_message_id', waIds)

    const existingIds = new Set((existing ?? []).map((m) => m.wa_message_id))

    const toInsert = evoMessages
      .filter((m) => {
        const id = (m.key as { id?: string })?.id
        return id && !existingIds.has(id)
      })
      .map((m) => {
        const key = m.key as { id: string; fromMe: boolean }
        const { content, type } = extractContent(m as EvoMessageRow)
        const status = STATUS_MAP[m.status ?? ''] ?? (key.fromMe ? 'sent' : 'delivered')
        const ts =
          m.messageTimestamp && m.messageTimestamp > 0
            ? new Date(m.messageTimestamp * 1000).toISOString()
            : new Date().toISOString()

        return {
          conversation_id: conversationId,
          wa_message_id: key.id,
          content,
          type,
          direction: (key.fromMe ? 'outbound' : 'inbound') as 'outbound' | 'inbound',
          status,
          created_at: ts,
        }
      })
      // Query returned newest-first; restore chronological order before inserting
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    if (toInsert.length > 0) {
      await supabase.from('messages').insert(toInsert)
    }

    return NextResponse.json({ ok: true, added: toInsert.length })
  } catch (err) {
    console.error('Messages sync error:', err)
    return NextResponse.json({ ok: true, added: 0 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// POST /api/conversations/[id]/read
// Marca todas as mensagens inbound não-lidas como lidas e zera unread_count.
// Envia read receipt via Evolution API para acionar os dois checks azuis no remetente.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Busca a conversa para obter wa_id
  const { data: conversation, error: convErr } = await supabaseAdmin
    .from('conversations')
    .select('id, wa_id, instance_name, unread_count')
    .eq('id', id)
    .maybeSingle()

  if (convErr || !conversation) {
    return NextResponse.json({ ok: false, error: 'conversation not found' }, { status: 404 })
  }

  if (conversation.unread_count === 0) {
    return NextResponse.json({ ok: true, updated: 0 })
  }

  // Busca mensagens inbound não-lidas para obter os IDs do WhatsApp
  const { data: unreadMessages } = await supabaseAdmin
    .from('messages')
    .select('id, wa_message_id')
    .eq('conversation_id', id)
    .eq('direction', 'inbound')
    .neq('status', 'read')

  // Atualiza status das mensagens inbound para 'read'
  await supabaseAdmin
    .from('messages')
    .update({ status: 'read' })
    .eq('conversation_id', id)
    .eq('direction', 'inbound')
    .neq('status', 'read')

  // Zera unread_count da conversa
  await supabaseAdmin
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', id)

  // Envia read receipt via Evolution API para as mensagens com wa_message_id
  const readableMessages = (unreadMessages ?? []).filter((m) => m.wa_message_id)
  if (readableMessages.length > 0) {
    const readMessages = readableMessages.map((m) => ({
      remoteJid: conversation.wa_id,
      fromMe: false,
      id: m.wa_message_id,
    }))

    try {
      await fetch(`${EVOLUTION_API_URL}/chat/markMessageAsRead/${conversation.instance_name}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ readMessages }),
      })
    } catch {
      // Read receipt é best-effort; falha silenciosa
    }
  }

  return NextResponse.json({ ok: true, updated: readableMessages.length })
}

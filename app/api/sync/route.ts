import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = 'flashflow-main'

interface EvoChat {
  id: string
  remoteJid: string
  pushName?: string
  lastMessage?: {
    key?: {
      remoteJidAlt?: string
    }
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
      imageMessage?: { caption?: string }
    }
    messageTimestamp?: number
  }
  unreadCount?: number
}

export async function POST() {
  try {
    const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findChats/${INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
      body: JSON.stringify({}),
    })

    if (!chatsRes.ok) {
      return NextResponse.json(
        { ok: false, error: 'Falha ao buscar chats da Evolution API' },
        { status: 500 }
      )
    }

    const chats: EvoChat[] = await chatsRes.json()

    if (!Array.isArray(chats)) {
      return NextResponse.json({ ok: false, error: 'Resposta inesperada da Evolution API' }, { status: 500 })
    }

    let synced = 0
    let failed = 0

    for (const chat of chats) {
      const jid = chat.remoteJid
      if (!jid) continue
      // Ignora grupos
      if (jid.endsWith('@g.us')) continue

      // Extrai telefone: JID normal ou fallback do lastMessage para contas LID
      let contactPhone: string
      if (jid.endsWith('@s.whatsapp.net')) {
        contactPhone = jid.replace('@s.whatsapp.net', '')
      } else if (jid.endsWith('@lid')) {
        // Tenta pegar telefone real do campo alternativo
        const alt = chat.lastMessage?.key?.remoteJidAlt
        contactPhone = alt ? alt.replace('@s.whatsapp.net', '') : jid.replace('@lid', '')
      } else {
        contactPhone = jid
      }

      const contactName = chat.pushName || null

      const lastMsg =
        chat.lastMessage?.message?.conversation ||
        chat.lastMessage?.message?.extendedTextMessage?.text ||
        (chat.lastMessage?.message?.imageMessage ? '[imagem]' : null)

      const lastMsgAt = chat.lastMessage?.messageTimestamp
        ? new Date(chat.lastMessage.messageTimestamp * 1000).toISOString()
        : null

      const { error } = await supabase.from('conversations').upsert(
        {
          wa_id: jid,
          contact_phone: contactPhone,
          contact_name: contactName,
          last_message: lastMsg,
          last_message_at: lastMsgAt,
          unread_count: chat.unreadCount ?? 0,
        },
        { onConflict: 'wa_id' }
      )

      if (error) {
        console.error(`Erro ao sincronizar ${jid}:`, error)
        failed++
      } else {
        synced++
      }
    }

    return NextResponse.json({ ok: true, total: chats.length, synced, failed })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

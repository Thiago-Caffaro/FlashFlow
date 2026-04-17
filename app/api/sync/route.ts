import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

// Prevents concurrent syncs for the same instance from mixing data.
// Module-scoped — persists for the lifetime of the server process.
const syncInProgress = new Set<string>()

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

export async function POST(req: NextRequest) {
  const instanceName = req.nextUrl.searchParams.get('instance') || 'flashflow-main'

  if (syncInProgress.has(instanceName)) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  syncInProgress.add(instanceName)
  try {
    // 1. Busca os contatos da Evolution API para mapear os nomes corretamente
    const contactsRes = await fetch(`${EVOLUTION_URL}/chat/findContacts/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
      body: JSON.stringify({}),
    })
    
    const contactsMap = new Map<string, { name: string; picUrl: string | null }>()
    if (contactsRes.ok) {
      const contactsData = await contactsRes.json()
      if (Array.isArray(contactsData)) {
        for (const c of contactsData) {
          if (c.remoteJid) {
            contactsMap.set(c.remoteJid, {
              name: c.pushName || c.name || null,
              picUrl: c.profilePicUrl ?? null,
            })
          }
        }
      }
    }

    // 2. Busca os chats da Evolution API
    const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findChats/${instanceName}`, {
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

      const isGroup = jid.endsWith('@g.us')

      // Extrai telefone e fallback name: JID normal ou fallback do lastMessage para contas LID
      let contactPhone: string
      let fallbackJid = jid

      if (isGroup) {
        contactPhone = jid // use full JID as identifier for groups
      } else if (jid.endsWith('@s.whatsapp.net')) {
        contactPhone = jid.replace('@s.whatsapp.net', '')
      } else if (jid.endsWith('@lid')) {
        const alt = chat.lastMessage?.key?.remoteJidAlt
        if (alt) {
          contactPhone = alt.replace('@s.whatsapp.net', '')
          fallbackJid = alt
        } else {
          contactPhone = jid.replace('@lid', '')
        }
      } else {
        contactPhone = jid
      }

      // For groups, pushName on the chat IS the group name.
      // For contacts, prefer contactsMap (has profile pic too), fall back to chat.pushName.
      const contactInfo = isGroup ? null : (contactsMap.get(jid) ?? contactsMap.get(fallbackJid) ?? null)
      const contactName = isGroup ? (chat.pushName ?? null) : (contactInfo?.name ?? chat.pushName ?? null)
      const profilePicUrl = contactInfo?.picUrl ?? null

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
          instance_name: instanceName,
          contact_phone: contactPhone,
          last_message: lastMsg,
          last_message_at: lastMsgAt,
          unread_count: chat.unreadCount ?? 0,
          // Never overwrite existing values with null
          ...(contactName ? { contact_name: contactName } : {}),
          ...(profilePicUrl ? { profile_pic_url: profilePicUrl } : {}),
        },
        { onConflict: 'wa_id, instance_name' }
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
  } finally {
    syncInProgress.delete(instanceName)
  }
}

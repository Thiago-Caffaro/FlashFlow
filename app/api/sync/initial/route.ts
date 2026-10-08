import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { importEvolutionHistory } from '@/lib/evolution-history'
import { createLogger } from '@/lib/logger'

const log = createLogger('sync-initial')

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

// ─── In-process progress store ────────────────────────────────────────────────
// Keyed by instanceName. Cleared when sync finishes or errors.

export interface SyncProgress {
  stage: 'contacts' | 'messages' | 'done' | 'error'
  total: number
  done: number
  error?: string
  cancelled?: boolean
  createdConversationIds?: string[]
}

const progress = new Map<string, SyncProgress>()

// ─── contacts sync ────────────────────────────────────────────────────────────

async function syncContacts(instanceName: string): Promise<string[]> {
  const contactsRes = await fetch(`${EVOLUTION_URL}/chat/findContacts/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
    body: JSON.stringify({}),
  }).catch(() => null)

  const contactsMap = new Map<string, { name: string | null; picUrl: string | null }>()
  if (contactsRes?.ok) {
    const data = await contactsRes.json().catch(() => [])
    if (Array.isArray(data)) {
      for (const c of data) {
        if (c.remoteJid) {
          contactsMap.set(c.remoteJid, {
            name: c.pushName || c.name || null,
            picUrl: c.profilePicUrl ?? null,
          })
        }
      }
    }
  }

  const chatsRes = await fetch(`${EVOLUTION_URL}/chat/findChats/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY! },
    body: JSON.stringify({}),
  }).catch(() => null)

  if (!chatsRes?.ok) return []
  const chats = await chatsRes.json().catch(() => [])
  if (!Array.isArray(chats)) return []

  const conversationIds: string[] = []

  for (const chat of chats) {
    const jid: string = chat.remoteJid
    if (!jid) continue

    const isGroup = jid.endsWith('@g.us')
    let contactPhone: string
    let fallbackJid = jid

    if (isGroup) {
      contactPhone = jid
    } else if (jid.endsWith('@s.whatsapp.net')) {
      contactPhone = jid.replace('@s.whatsapp.net', '')
    } else if (jid.endsWith('@lid')) {
      const alt = chat.lastMessage?.key?.remoteJidAlt
      contactPhone = alt ? alt.replace('@s.whatsapp.net', '') : jid.replace('@lid', '')
      if (alt) fallbackJid = alt
    } else {
      contactPhone = jid
    }

    const info = isGroup ? null : (contactsMap.get(jid) ?? contactsMap.get(fallbackJid) ?? null)
    const contactName = isGroup ? (chat.pushName ?? null) : (info?.name ?? chat.pushName ?? null)
    const profilePicUrl = info?.picUrl ?? null

    const lastMsg =
      chat.lastMessage?.message?.conversation ||
      chat.lastMessage?.message?.extendedTextMessage?.text ||
      (chat.lastMessage?.message?.imageMessage ? '[imagem]' : null)

    const lastMsgAt = chat.lastMessage?.messageTimestamp
      ? new Date(chat.lastMessage.messageTimestamp * 1000).toISOString()
      : null

    const { data: conv } = await supabase
      .from('conversations')
      .upsert(
        {
          wa_id: fallbackJid,
          instance_name: instanceName,
          contact_phone: contactPhone,
          last_message: lastMsg,
          last_message_at: lastMsgAt,
          unread_count: chat.unreadCount ?? 0,
          ...(contactName ? { contact_name: contactName } : {}),
          ...(profilePicUrl ? { profile_pic_url: profilePicUrl } : {}),
        },
        { onConflict: 'wa_id, instance_name' }
      )
      .select('id')
      .single()

    if (conv?.id) conversationIds.push(conv.id)
  }

  return conversationIds
}

// ─── instance id lookup ───────────────────────────────────────────────────────

async function getInstanceId(instanceName: string): Promise<string | null> {
  const { data } = await supabase
    .from('Instance')
    .select('id')
    .eq('name', instanceName)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

// ─── background sync runner ───────────────────────────────────────────────────

async function runSync(instanceName: string) {
  try {
    progress.set(instanceName, { stage: 'contacts', total: 0, done: 0 })
    console.log(`[SYNC initial] iniciando para "${instanceName}"`)

    // Evolution API can take 30-60s to receive chat history from the phone after a QR scan.
    // We retry every 3s for the first 10 attempts, then every 10s up to 2 minutes total.
    let conversationIds: string[] = []
    const syncStart = Date.now()
    const MAX_WAIT_MS = 120_000
    let attempt = 0

    while (conversationIds.length === 0) {
      if (progress.get(instanceName)?.cancelled) break

      if (attempt > 0) {
        const delay = attempt < 10 ? 3000 : 10_000
        await new Promise((r) => setTimeout(r, delay))
      }

      // Tenta findChats na Evolution API
      conversationIds = await syncContacts(instanceName)

      // Fallback: o handler chats.upsert pode ter criado conversas antes do findChats funcionar
      if (conversationIds.length === 0) {
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .eq('instance_name', instanceName)
        if ((existing?.length ?? 0) > 0) {
          conversationIds = existing!.map((c) => c.id as string)
          console.log(`[SYNC initial] tentativa ${attempt + 1} → findChats=0 mas ${conversationIds.length} conversa(s) já criadas via chats.upsert`)
        } else {
          attempt++
          console.log(`[SYNC initial] tentativa ${attempt} → ${conversationIds.length} conversa(s)`)
        }
      } else {
        attempt++
        console.log(`[SYNC initial] tentativa ${attempt} → ${conversationIds.length} conversa(s) via findChats`)
      }

      if (Date.now() - syncStart >= MAX_WAIT_MS) {
        console.log(`[SYNC initial] timeout de 2 minutos atingido após ${attempt} tentativas`)
        break
      }
    }

    const total = conversationIds.length

    if (total === 0) {
      console.log(`[SYNC initial] nenhuma conversa encontrada — encerrando`)
      progress.set(instanceName, { stage: 'done', total: 0, done: 0 })
      return
    }

    progress.set(instanceName, { stage: 'messages', total, done: 0, createdConversationIds: conversationIds })

    const instanceId = await getInstanceId(instanceName)
    console.log(`[SYNC initial] instanceId da Evolution API: ${instanceId ?? 'NÃO ENCONTRADO'}`)

    if (instanceId) {
      const { count: msgCount } = await supabase
        .from('Message')
        .select('*', { count: 'exact', head: true })
        .eq('instanceId', instanceId)
      console.log(`[SYNC initial] registros na tabela Message da Evolution API: ${msgCount}`)
    }

    const { data: convRows } = await supabase
      .from('conversations')
      .select('id, wa_id')
      .in('id', conversationIds)

    const convMap = new Map((convRows ?? []).map((r) => [r.id, r.wa_id as string]))

    const historyTotals = { added: 0, alreadyElsewhere: 0, unknownFormat: 0, failed: 0 }
    for (let i = 0; i < conversationIds.length; i++) {
      if (progress.get(instanceName)?.cancelled) break

      const convId = conversationIds[i]
      const waId = convMap.get(convId)

      if (instanceId && waId) {
        // Uma conversa com falha não interrompe as outras — mas é contada e
        // logada, em vez de sumir como antes (insert sem checagem de erro).
        try {
          const result = await importEvolutionHistory({ conversationId: convId, instanceId, remoteJid: waId })
          historyTotals.added += result.added
          historyTotals.alreadyElsewhere += result.alreadyElsewhere
          historyTotals.unknownFormat += result.unknownFormat
        } catch (error) {
          historyTotals.failed += 1
          log.warn('falha ao importar histórico de uma conversa', { instance: instanceName, conversationId: convId, err: error }, { throttleKey: `initial:${instanceName}` })
        }
      }

      progress.set(instanceName, { stage: 'messages', total, done: i + 1, createdConversationIds: conversationIds })
    }

    log.info('sincronização inicial concluída', { instance: instanceName, conversations: total, ...historyTotals })
    progress.set(instanceName, { stage: 'done', total, done: total })
  } catch (err) {
    console.error(`[SYNC initial] erro:`, err)
    progress.set(instanceName, { stage: 'error', total: 0, done: 0, error: String(err) })
  }
}

// ─── cancel + cleanup ─────────────────────────────────────────────────────────

async function cancelAndCleanup(instanceName: string) {
  const p = progress.get(instanceName)
  if (!p) return
  progress.set(instanceName, { ...p, cancelled: true })
  // give the loop one tick to notice the flag
  await new Promise((r) => setTimeout(r, 600))
  const ids = p.createdConversationIds ?? []
  if (ids.length > 0) {
    await supabase.from('messages').delete().in('conversation_id', ids)
    await supabase.from('conversations').delete().in('id', ids)
  }
  progress.delete(instanceName)
}

// ─── routes ───────────────────────────────────────────────────────────────────

/** POST — starts the sync in the background and returns immediately */
export async function POST(req: NextRequest) {
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'

  // Cloud API accounts have no Evolution instance to pull history from — the
  // Meta Cloud API has no "existing chat history" concept to sync.
  const { data: account } = await supabase
    .from('accounts')
    .select('provider')
    .eq('instance_name', instanceName)
    .maybeSingle()
  if (account?.provider === 'cloud_api') {
    progress.set(instanceName, { stage: 'done', total: 0, done: 0 })
    return NextResponse.json({ ok: true })
  }

  const current = progress.get(instanceName)
  if (current && current.stage !== 'done' && current.stage !== 'error') {
    return NextResponse.json({ ok: true, alreadyRunning: true })
  }

  // Fire and forget — client polls GET for progress
  runSync(instanceName)

  return NextResponse.json({ ok: true })
}

/** GET — returns current progress for the given instance */
export async function GET(req: NextRequest) {
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'
  const p = progress.get(instanceName) ?? { stage: 'idle', total: 0, done: 0 }
  return NextResponse.json(p)
}

/** DELETE — cancels an in-progress sync and rolls back created data */
export async function DELETE(req: NextRequest) {
  const instanceName = req.nextUrl.searchParams.get('instance') ?? 'flashflow-main'
  await cancelAndCleanup(instanceName)
  return NextResponse.json({ ok: true })
}

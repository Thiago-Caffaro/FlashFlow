import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { executeFlow, checkActiveFlowRun, checkActiveSession, handleActiveSession } from '@/lib/flow-engine'
import { cacheQr, clearQr } from '@/lib/qr-cache'
import { logWebhookEvent } from '@/lib/webhook-log'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

async function ensureMediaBucket() {
  await supabase.storage.createBucket('media', { public: true }).catch(() => {})
}

async function storeBase64Media(
  base64Raw: string,
  mimetype: string,
  messageId: string
): Promise<string | null> {
  try {
    const b64Data = base64Raw.includes(',') ? base64Raw.split(',')[1] : base64Raw
    if (!b64Data) return null

    const buffer = Buffer.from(b64Data, 'base64')
    const ext = mimetype.split('/')[1]?.split(';')[0] ?? 'jpg'
    const path = `${Date.now()}-${messageId}.${ext}`

    await ensureMediaBucket()

    const { error } = await supabase.storage
      .from('media')
      .upload(path, buffer, { contentType: mimetype })

    if (error) return null

    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path)
    return publicUrl
  } catch {
    return null
  }
}

async function downloadAndStoreMedia(
  fullMessageData: Record<string, unknown>,
  messageId: string,
  instanceName: string
): Promise<string | null> {
  try {
    // Tenta obter base64 via Evolution API (necessário quando webhookBase64 = false)
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ message: fullMessageData }),
      }
    )
    if (!res.ok) return null

    const data = await res.json()
    const base64Raw: string = data.base64 ?? ''
    const mimetype: string = data.mimetype ?? 'image/jpeg'

    return storeBase64Media(base64Raw, mimetype, messageId)
  } catch {
    return null
  }
}

// Status da Evolution API → nosso sistema
const EVO_STATUS_MAP: Record<string, string> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  '2': 'sent',
  '3': 'delivered',
  '4': 'read',
  '5': 'read',
}

async function executeTriggers(
  instanceName: string,
  remoteJid: string,
  conversationId: string,
  messageContent: string,
  messageType: string
) {
  if (messageType !== 'text') return

  const { data: triggers, error } = await supabase
    .from('triggers')
    .select('*')
    .eq('instance_name', instanceName)

  if (error || !triggers || triggers.length === 0) return

  for (const trigger of triggers) {
    const valors = (trigger.valor ?? '')
      .split(',')
      .map((v: string) => v.trim().toLowerCase())
      .filter(Boolean)
    if (valors.length === 0) continue

    const isWildcard = valors.includes('*')
    const content = messageContent.toLowerCase()
    const matched = isWildcard || valors.some((v: string) =>
      trigger.tipo === 'exact' ? content === v : content.includes(v)
    )
    if (!matched) continue

    const delayMs: number = trigger.delay_ms ?? 0

    if (trigger.action === 'send_message') {
      const replyText: string = trigger.action_payload?.message ?? ''
      if (!replyText.trim()) continue

      const sendReply = async () => {
        try {
          const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
            body: JSON.stringify({ number: remoteJid, text: replyText }),
          })
          const evoData = await res.json().catch(() => ({}))
          const waMessageId: string | null = evoData?.key?.id ?? null

          await supabase.from('messages').insert({
            conversation_id: conversationId,
            wa_message_id: waMessageId,
            content: replyText,
            type: 'text',
            direction: 'outbound',
            status: 'sent',
          })
          await supabase.from('conversations').update({
            last_message: replyText,
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          }).eq('id', conversationId)
        } catch (err) {
          console.error('Trigger send error:', err)
        }
      }

      if (delayMs > 0) setTimeout(sendReply, delayMs)
      else await sendReply()
    }

    if (trigger.action === 'flow') {
      const flowId: string = trigger.action_payload?.flow_id ?? ''
      if (!flowId) continue

      const runFlow = async () => {
        // Re-check session right before executing — handles race conditions and delayed triggers
        const activeSession = await checkActiveSession(instanceName, remoteJid)
        if (activeSession) return
        await executeFlow(flowId, { instanceName, remoteJid, conversationId, incomingMessage: messageContent })
          .catch((err) => console.error('executeFlow error:', err))
      }

      if (delayMs > 0) setTimeout(runFlow, delayMs)
      else await runFlow()
    }

    break // para no primeiro gatilho que bateu
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const event = (body.event ?? '').toLowerCase()
    const evtInstance: string = body.instance ?? ''
    console.log(`[webhook] received event="${event}" instance="${evtInstance}"`)
    logWebhookEvent(event, evtInstance, body.data ?? {})

    if (event === 'qrcode.updated' || event === 'qrcode_updated') {
      const instanceName: string = body.instance ?? ''
      const qr: string | null =
        body.data?.qrcode?.base64 ??
        body.data?.base64 ??
        (typeof body.data?.qrcode === 'string' ? body.data.qrcode : null) ??
        null
      console.log(`[webhook] qrcode event for "${instanceName}" qr=${!!qr}`)
      if (instanceName && qr) cacheQr(instanceName, qr)
      return NextResponse.json({ ok: true })
    }

    if (event === 'connection.update' || event === 'connection_update') {
      const instanceName: string = body.instance ?? ''
      const state: string = (body.data?.instance?.state ?? body.data?.state ?? '').toLowerCase()
      const reason = body.data?.statusReason ?? body.data?.instance?.statusReason ?? null
      console.log(`[webhook] connection.update "${instanceName}" state=${state} reason=${reason}`)
      if (state === 'close' && reason === 401) {
        console.error(`[webhook] AUTH-401 "${instanceName}" — QR nunca gerado. Proxy pode estar bloqueando nova sessão.`)
      }
      if (state === 'open' && instanceName) clearQr(instanceName)
      return NextResponse.json({ ok: true })
    }

    if (event === 'messages.update') {
      const updates: Array<{ key: { id: string; fromMe: boolean }; update: { status: string } }> =
        Array.isArray(body.data) ? body.data : []

      await Promise.all(
        updates
          .filter((u) => u.key?.fromMe === true && u.update?.status)
          .map((u) => {
            const status = EVO_STATUS_MAP[String(u.update.status)] ?? null
            if (!status) return Promise.resolve()
            return supabase
              .from('messages')
              .update({ status })
              .eq('wa_message_id', u.key.id)
          })
      )
      return NextResponse.json({ ok: true })
    }

    // Quando o WhatsApp sincroniza a lista de chats com a Evolution API, ela envia CHATS_UPSERT.
    // Processamos aqui para criar conversas imediatamente — sem depender do endpoint findChats.
    if (event === 'chats.upsert') {
      const chats = Array.isArray(body.data) ? body.data : []
      const instanceName: string = body.instance ?? ''
      if (instanceName && chats.length > 0) {
        console.log(`[webhook] chats.upsert: ${chats.length} chat(s) para "${instanceName}"`)
        for (const chat of chats) {
          const remoteJid: string = chat.remoteJid ?? ''
          if (!remoteJid || !remoteJid.includes('@')) continue
          // Skip @lid JIDs — Evolution sends them for some contacts but they create duplicate
          // conversations separate from the @s.whatsapp.net entry for the same contact
          if (remoteJid.endsWith('@lid')) continue
          const isGroup = remoteJid.endsWith('@g.us')
          const contactPhone = isGroup
            ? remoteJid
            : remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')
          const contactName: string | null = chat.name ?? chat.pushName ?? null
          const unreadCount: number = chat.unreadCount ?? 0

          await supabase.from('conversations').upsert(
            {
              wa_id: remoteJid,
              instance_name: instanceName,
              contact_phone: contactPhone,
              unread_count: unreadCount,
              ...(contactName ? { contact_name: contactName } : {}),
            },
            { onConflict: 'wa_id, instance_name' }
          )
        }
      }
      return NextResponse.json({ ok: true })
    }

    if (event !== 'messages.upsert') {
      return NextResponse.json({ ok: true })
    }

    const data = body.data
    if (!data?.key || !data?.message) {
      return NextResponse.json({ ok: true })
    }

    const instanceName: string = body.instance ?? 'flashflow-main'
    const waMessageId: string = data.key.id
    const remoteJid: string = data.key.remoteJid

    console.log(`[webhook] messages.upsert instance="${instanceName}" from="${remoteJid}" fromMe=${data.key.fromMe} msgId="${waMessageId}"`)

    // Dedup: Evolution API pode reenviar o mesmo webhook; evita violação de constraint
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('wa_message_id', waMessageId)
      .maybeSingle()

    if (existingMsg) {
      console.log(`[webhook] messages.upsert SKIP (dedup) msgId="${waMessageId}"`)
      return NextResponse.json({ ok: true })
    }

    const isGroup = remoteJid.endsWith('@g.us')

    // @lid is an internal WhatsApp ID that Evolution sometimes uses instead of @s.whatsapp.net.
    // Resolve to the existing @s.whatsapp.net conversation so messages don't split into two rows.
    let effectiveRemoteJid = remoteJid
    if (!isGroup && remoteJid.endsWith('@lid')) {
      if (data.key.fromMe === false) {
        // Inbound: resolve by contact name (pushName comes from the sender)
        const lidPushName: string | null = data.pushName ?? null
        if (lidPushName) {
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('wa_id')
            .eq('instance_name', instanceName)
            .eq('contact_name', lidPushName)
            .not('wa_id', 'like', '%@lid')
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (existingConv?.wa_id) effectiveRemoteJid = existingConv.wa_id
        }
      } else {
        // Outbound: no pushName available — find any non-@lid conversation already open
        // with this instance that has last_message_at set (i.e., a real conversation).
        // This covers the case where the sync already created @s.whatsapp.net and the
        // AI/operator replies back to the same contact identified by @lid.
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('wa_id')
          .eq('instance_name', instanceName)
          .eq('contact_phone', remoteJid.replace('@lid', ''))
          .not('wa_id', 'like', '%@lid')
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (existingConv?.wa_id) effectiveRemoteJid = existingConv.wa_id
      }
    }

    const contactPhone = isGroup ? remoteJid : effectiveRemoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')

    // For groups: pushName is the SENDER's name, not the group name.
    // Never overwrite the group name with a sender's name — look up the group name from our DB.
    // For contacts: use pushName from payload, fall back to Contact/Chat tables.
    let contactName: string | null = null

    if (isGroup) {
      // Preserve the group name already stored — don't touch it from webhook payload
      const { data: existing } = await supabase
        .from('conversations')
        .select('contact_name')
        .eq('wa_id', remoteJid)
        .eq('instance_name', instanceName)
        .maybeSingle()
      contactName = (existing as { contact_name?: string | null } | null)?.contact_name ?? null

      if (!contactName) {
        // First time seeing this group — look it up from Evolution's Chat table
        const { data: chatRow } = await supabase
          .from('Chat')
          .select('name')
          .eq('remoteJid', remoteJid)
          .maybeSingle()
        contactName = chatRow?.name || null
      }
    } else {
      contactName = data.key.fromMe === false ? (data.pushName || null) : null

      if (!contactName) {
        const { data: contactRow } = await supabase
          .from('Contact')
          .select('pushName')
          .eq('remoteJid', remoteJid)
          .maybeSingle()
        contactName = contactRow?.pushName || null

        if (!contactName) {
          const { data: chatRow } = await supabase
            .from('Chat')
            .select('name')
            .eq('remoteJid', remoteJid)
            .maybeSingle()
          contactName = chatRow?.name || null
        }
      }
    }
    const msgObj = data.message

    let content = ''
    let type = 'text'

    if (msgObj.conversation || msgObj.extendedTextMessage?.text) {
      content = msgObj.conversation || msgObj.extendedTextMessage.text
      type = 'text'
    } else if (msgObj.imageMessage) {
      type = 'image'
      // Se webhookBase64=true na Evolution, o base64 já vem no payload
      const inlineBase64: string = msgObj.imageMessage.base64 ?? ''
      const mimetype: string = msgObj.imageMessage.mimetype ?? 'image/jpeg'

      let mediaUrl: string | null = null
      if (inlineBase64) {
        mediaUrl = await storeBase64Media(inlineBase64, mimetype, waMessageId)
      } else {
        mediaUrl = await downloadAndStoreMedia(data, waMessageId, instanceName)
      }
      content = mediaUrl ?? msgObj.imageMessage.caption ?? '[imagem]'
    } else if (msgObj.videoMessage) {
      content = msgObj.videoMessage.caption ?? '[vídeo]'
      type = 'video'
    } else if (msgObj.stickerMessage) {
      content = '[figurinha]'
      type = 'sticker'
    } else if (msgObj.audioMessage || msgObj.pttMessage) {
      content = '[áudio]'
      type = 'audio'
    } else {
      content = '[mídia]'
      type = 'media'
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          wa_id: effectiveRemoteJid,
          instance_name: instanceName,
          contact_phone: contactPhone,
          // Só atualiza contact_name se pushName veio preenchido,
          // para não sobrescrever um nome existente com null
          ...(contactName ? { contact_name: contactName } : {}),
          last_message:
            type === 'image' ? '[imagem]' :
            type === 'video' ? '[vídeo]' :
            type === 'sticker' ? '[figurinha]' :
            content,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'wa_id, instance_name' }
      )
      .select()
      .single()

    if (convError) {
      console.error('Erro ao upsert conversa:', convError)
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    // Incrementa unread_count apenas para mensagens recebidas; zera para as próprias
    await supabase
      .from('conversations')
      .update({
        unread_count: data.key.fromMe === true
          ? 0
          : (conversation.unread_count ?? 0) + 1,
      })
      .eq('id', conversation.id)

    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      wa_message_id: waMessageId,
      content,
      type,
      direction: data.key.fromMe === true ? 'outbound' : 'inbound',
      status: data.key.fromMe === true ? 'sent' : 'delivered',
      sender_type: data.key.fromMe === true ? 'human' : null,
      sender_jid:  isGroup ? (data.key.participant ?? null) : null,
      sender_name: isGroup ? (data.pushName || null)        : null,
    })
    if (msgError) {
      console.error('[webhook] Erro ao inserir mensagem:', msgError.message, { waMessageId, conversationId: conversation.id })
    } else {
      console.log(`[webhook] messages.upsert SAVED conv="${conversation.id}" dir=${data.key.fromMe ? 'out' : 'in'} content="${content.slice(0, 60)}"`)
    }

    if (data.key.fromMe !== true && type === 'text') {
      void (async () => {
        try {
          const flowRun = await checkActiveFlowRun(instanceName, effectiveRemoteJid)
          if (flowRun) {
            await executeFlow(flowRun.flow_id, {
              instanceName,
              remoteJid: effectiveRemoteJid,
              conversationId: conversation.id,
              incomingMessage: content,
            }, flowRun.node_id)
          } else {
            const session = await checkActiveSession(instanceName, effectiveRemoteJid)
            if (session) {
            await handleActiveSession(session, {
              instanceName,
              remoteJid: effectiveRemoteJid,
              conversationId: conversation.id,
              incomingMessage: content,
            })
            } else {
              await executeTriggers(instanceName, effectiveRemoteJid, conversation.id, content, type)
            }
          }
        } catch (err) {
          console.error('session/trigger error:', err)
        }
      })()
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

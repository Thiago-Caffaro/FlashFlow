import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { executeFlow, checkActiveSession, handleActiveSession } from '@/lib/flow-engine'

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
    const valor = (trigger.valor ?? '').trim().toLowerCase()
    if (!valor) continue

    const content = messageContent.toLowerCase()
    const matched =
      trigger.tipo === 'exact' ? content === valor : content.includes(valor)
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

      const runFlow = () =>
        executeFlow(flowId, { instanceName, remoteJid, conversationId, incomingMessage: messageContent })
          .catch((err) => console.error('executeFlow error:', err))

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

    if (data.key.fromMe === true) {
      // Verifica se essa mensagem já foi salva pelo FlashFlow (via /api/messages)
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('wa_message_id', waMessageId)
        .maybeSingle()

      if (existing) {
        // Já existe: enviada pelo FlashFlow — ignora para evitar duplicata
        return NextResponse.json({ ok: true })
      }
      // Não existe: enviada por outro dispositivo — processa como outbound
    }

    const isGroup = remoteJid.endsWith('@g.us')
    const contactPhone = isGroup ? remoteJid : remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')

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
          wa_id: remoteJid,
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
          unread_count: 1,
        },
        { onConflict: 'wa_id, instance_name' }
      )
      .select()
      .single()

    if (convError) {
      console.error('Erro ao upsert conversa:', convError)
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      wa_message_id: waMessageId,
      content,
      type,
      direction: data.key.fromMe === true ? 'outbound' : 'inbound',
      status: data.key.fromMe === true ? 'sent' : 'delivered',
      sender_jid:  isGroup ? (data.key.participant ?? null) : null,
      sender_name: isGroup ? (data.pushName || null)        : null,
    })

    if (data.key.fromMe !== true && type === 'text') {
      void (async () => {
        try {
          const session = await checkActiveSession(instanceName, remoteJid)
          if (session) {
            await handleActiveSession(session, {
              instanceName,
              remoteJid,
              conversationId: conversation.id,
              incomingMessage: content,
            })
          } else {
            await executeTriggers(instanceName, remoteJid, conversation.id, content, type)
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
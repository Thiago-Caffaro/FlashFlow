import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!
const INSTANCE = 'flashflow-main'

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
  messageId: string
): Promise<string | null> {
  try {
    // Tenta obter base64 via Evolution API (necessário quando webhookBase64 = false)
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${INSTANCE}`,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.event === 'messages.update') {
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

    if (body.event !== 'messages.upsert') {
      return NextResponse.json({ ok: true })
    }

    const data = body.data
    if (!data?.key || !data?.message) {
      return NextResponse.json({ ok: true })
    }

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

    const contactPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')
    const contactName: string | null = data.pushName || null
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
        mediaUrl = await downloadAndStoreMedia(data, waMessageId)
      }
      content = mediaUrl ?? msgObj.imageMessage.caption ?? '[imagem]'
    } else {
      content = '[mídia]'
      type = 'media'
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          wa_id: remoteJid,
          contact_phone: contactPhone,
          // Só atualiza contact_name se pushName veio preenchido,
          // para não sobrescrever um nome existente com null
          ...(contactName ? { contact_name: contactName } : {}),
          last_message: type === 'image' ? '📷 Imagem' : content,
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        },
        { onConflict: 'wa_id' }
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
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Ignora eventos que não são mensagens
    if (body.event !== 'messages.upsert') {
      return NextResponse.json({ ok: true })
    }

    const data = body.data
    if (!data?.key || !data?.message) {
      return NextResponse.json({ ok: true })
    }

    // Ignora mensagens enviadas por você
    if (data.key.fromMe === true) {
      return NextResponse.json({ ok: true })
    }

    // Extrai número e conteúdo
    const waId = data.key.remoteJid.replace('@s.whatsapp.net', '')
    const content =
      data.message.conversation ||
      data.message.extendedTextMessage?.text ||
      '[mídia]'
    const contactName = data.pushName || null
    const waMessageId = data.key.id

    // Upsert na conversa (cria se não existe, atualiza se existe)
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          wa_id: waId,
          contact_phone: waId,
          contact_name: contactName,
          last_message: content,
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

    // Salva a mensagem
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      wa_message_id: waMessageId,
      content,
      type: 'text',
      direction: 'inbound',
      status: 'delivered',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from '@/lib/whatsapp-text'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: 'conversationId required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, messages: data ?? [] }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(req: NextRequest) {
  try {
    const { conversationId, waId, content } = await req.json()

    if (!conversationId || !waId || !content) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    // Busca instance_name da conversa
    const { data: conv } = await supabase
      .from('conversations')
      .select('instance_name')
      .eq('id', conversationId)
      .maybeSingle()
    const instanceName = conv?.instance_name ?? 'flashflow-main'

    console.log(`[messages/send] instance="${instanceName}" to="${waId}" content="${content.slice(0, 60)}"`)

    const sent = await sendWhatsAppText({ instanceName, number: waId, text: content })
    const waMessageId = sent.messageId

    console.log(`[messages/send] Evolution msgId="${waMessageId}" ok=true`)

    // Salva no Supabase
    const { data: message } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        wa_message_id: waMessageId,
        content,
        type: 'text',
        direction: 'outbound',
        status: 'sent',
      })
      .select()
      .single()

    // Atualiza last_message na conversa
    await supabase
      .from('conversations')
      .update({
        last_message: content,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ ok: true, message })
  } catch (err) {
    console.error('Send error:', err)
    return NextResponse.json({ ok: false, error: 'Falha ao enviar mensagem' }, { status: 500 })
  }
}

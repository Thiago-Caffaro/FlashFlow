import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { conversationId, waId, content } = await req.json()

    if (!conversationId || !waId || !content) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    // Envia pelo Evolution API
    const evoRes = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendText/flashflow-main`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EVOLUTION_API_KEY!,
        },
        body: JSON.stringify({ number: waId, text: content }),
      }
    )

    const evoData = await evoRes.json().catch(() => ({}))
    const waMessageId: string | null = evoData?.key?.id ?? null

    if (!evoRes.ok) {
      console.error('Erro Evolution API:', evoData)
      return NextResponse.json({ error: 'Falha ao enviar mensagem' }, { status: 500 })
    }

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
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
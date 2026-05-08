import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadFileToStorage } from '@/lib/storage'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const conversationId = formData.get('conversationId') as string | null
    const waId = formData.get('waId') as string | null
    const caption = (formData.get('caption') as string | null) ?? ''

    if (!file || !conversationId || !waId) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const { url: publicUrl } = await uploadFileToStorage(buffer, file.name, file.type)

    const { data: conv } = await supabase
      .from('conversations')
      .select('instance_name')
      .eq('id', conversationId)
      .maybeSingle()
    const instanceName = conv?.instance_name ?? 'flashflow-main'

    const evoRes = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendMedia/${instanceName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EVOLUTION_API_KEY!,
        },
        body: JSON.stringify({
          number: waId,
          mediatype: 'image',
          media: publicUrl,
          caption,
        }),
      }
    )

    if (!evoRes.ok) {
      console.error('Erro Evolution API:', await evoRes.text())
      return NextResponse.json({ error: 'Falha ao enviar imagem' }, { status: 500 })
    }

    const evoData = await evoRes.json()
    const waMessageId: string | null = evoData?.key?.id ?? null

    const { data: message } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        wa_message_id: waMessageId,
        content: publicUrl,
        type: 'image',
        direction: 'outbound',
        status: 'sent',
      })
      .select()
      .single()

    await supabase
      .from('conversations')
      .update({
        last_message: caption || '📷 Imagem',
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    // Limpa notificação de escalação quando operador responde manualmente
    await supabase
      .from('ai_sessions')
      .update({ requires_human: false })
      .eq('instance_name', instanceName)
      .eq('remote_jid', waId)
      .eq('requires_human', true)

    return NextResponse.json({ ok: true, message })
  } catch (err) {
    console.error('Send image error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

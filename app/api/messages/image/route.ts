import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadFileToStorage } from '@/lib/storage'
import { extensionForSniffedType, sniffImageType } from '@/lib/image-validation'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_SEND_TIMEOUT_MS = 15000
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const conversationId = formData.get('conversationId') as string | null
    const caption = (formData.get('caption') as string | null) ?? ''

    if (!file || !conversationId) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Imagem excede o limite de 5MB' }, { status: 400 })
    }

    // O destino (wa_id/instance_name) vem exclusivamente da conversa
    // carregada no servidor — nunca de um waId enviado pelo cliente. Falha
    // antes de subir o arquivo se a conversa não existir.
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, wa_id, instance_name')
      .eq('id', conversationId)
      .maybeSingle()

    if (!conv) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const { wa_id: waId, instance_name: instanceName } = conv

    const buffer = await file.arrayBuffer()
    // Nunca confia no Content-Type/nome enviado pelo cliente — detecta o
    // formato real pelos magic bytes. SVG e outros formatos "ativos" nunca
    // passam aqui, apenas raster puro (jpeg/png/gif/webp).
    const sniffed = sniffImageType(Buffer.from(buffer))
    if (!sniffed) {
      return NextResponse.json({ error: 'Formato de imagem não suportado ou arquivo corrompido' }, { status: 400 })
    }
    const { url: publicUrl } = await uploadFileToStorage(buffer, `image.${extensionForSniffedType(sniffed)}`, sniffed)

    // Registra como "sending" antes de chamar a Evolution — mesmo raciocínio
    // do envio de texto: timeout não significa que a mensagem não foi aceita.
    const { data: pending, error: pendingError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        wa_message_id: null,
        content: publicUrl,
        type: 'image',
        direction: 'outbound',
        status: 'sending',
      })
      .select()
      .single()

    if (pendingError || !pending) {
      return NextResponse.json({ error: 'Falha ao registrar mensagem' }, { status: 500 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), EVOLUTION_SEND_TIMEOUT_MS)
    let evoRes: Response
    try {
      evoRes = await fetch(
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
          signal: controller.signal,
        }
      )
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      if (!isTimeout) {
        await supabase.from('messages').update({ status: 'failed' }).eq('id', pending.id)
      }
      console.error(`[messages/image] falha msg="${pending.id}" timeout=${isTimeout}:`, err instanceof Error ? err.message : err)
      return NextResponse.json(
        { error: isTimeout ? 'Tempo esgotado ao enviar — resultado desconhecido.' : 'Falha ao enviar imagem' },
        { status: isTimeout ? 504 : 502 }
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!evoRes.ok) {
      await supabase.from('messages').update({ status: 'failed' }).eq('id', pending.id)
      console.error('Erro Evolution API:', await evoRes.text())
      return NextResponse.json({ error: 'Falha ao enviar imagem' }, { status: 502 })
    }

    const evoData = await evoRes.json()
    const waMessageId: string | null = evoData?.key?.id ?? null

    const { data: updated, error: updateError } = await supabase
      .from('messages')
      .update({ wa_message_id: waMessageId, status: 'sent' })
      .eq('id', pending.id)
      .select()
      .single()

    if (updateError) {
      console.error(`[messages/image] enviado mas falhou ao persistir msg="${pending.id}":`, updateError.message)
    }

    const message = updated ?? { ...pending, wa_message_id: waMessageId, status: 'sent' }

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

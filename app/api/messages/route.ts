import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from '@/lib/whatsapp-text'
import { finalizePendingOutbound } from '@/lib/outbound-message'
import { createLogger } from '@/lib/logger'

const log = createLogger('messages-send')

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_RECENT_MESSAGES = 100

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  const instanceName = req.nextUrl.searchParams.get('instance')
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: 'conversationId required' }, { status: 400 })
  }
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('instance_name')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv || conv.instance_name !== instanceName) {
    return NextResponse.json({ ok: false, error: 'conversation not found' }, { status: 404 })
  }

  // ?recent=N: só as N mensagens mais novas (em ordem cronológica). É o que
  // o polling do chat usa — o histórico inteiro só é baixado ao abrir a
  // conversa, em vez de a cada poucos segundos.
  const recentParam = Number(req.nextUrl.searchParams.get('recent'))
  const recent = Number.isInteger(recentParam) && recentParam > 0
    ? Math.min(recentParam, MAX_RECENT_MESSAGES)
    : null

  const query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
  const { data, error } = recent
    ? await query.order('created_at', { ascending: false }).limit(recent)
    : await query.order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const messages = recent ? [...(data ?? [])].reverse() : data ?? []
  return NextResponse.json({ ok: true, messages }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const conversationId: string = typeof body.conversationId === 'string' ? body.conversationId : ''
    const content: string = typeof body.content === 'string' ? body.content : ''

    if (!conversationId || !content) {
      return NextResponse.json({ ok: false, error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    // O destino (wa_id/instance_name) vem exclusivamente da conversa
    // carregada no servidor — nunca do corpo da requisição. Um waId
    // adulterado no cliente não pode mais redirecionar o envio para outro
    // contato, e não há fallback para "flashflow-main" quando a conversa não
    // é encontrada: falhamos antes de qualquer tentativa de envio.
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, wa_id, instance_name')
      .eq('id', conversationId)
      .maybeSingle()

    if (!conv) {
      return NextResponse.json({ ok: false, error: 'Conversa não encontrada' }, { status: 404 })
    }

    const { wa_id: waId, instance_name: instanceName } = conv

    // Registra a mensagem como "sending" ANTES de chamar a Evolution API. Se
    // a chamada expirar (timeout) sem resposta, o resultado real é
    // desconhecido — a Evolution pode ter aceitado a mensagem mesmo assim —
    // então preferimos deixar um rastro em vez de simplesmente não persistir
    // nada e o operador não ter como saber que uma tentativa aconteceu.
    const { data: pending, error: pendingError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        wa_message_id: null,
        content,
        type: 'text',
        direction: 'outbound',
        status: 'sending',
      })
      .select()
      .single()

    if (pendingError || !pending) {
      return NextResponse.json({ ok: false, error: 'Falha ao registrar mensagem' }, { status: 500 })
    }


    let sent
    try {
      sent = await sendWhatsAppText({ instanceName, number: waId, text: content })
    } catch (err) {
      // AbortError = timeout do lado do FlashFlow, não necessariamente uma
      // rejeição da Evolution — mantém o status "sending" (resultado
      // desconhecido) em vez de marcar como falho, para não induzir um
      // reenvio que duplicaria a mensagem caso ela tenha sido aceita.
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      if (!isTimeout) {
        await supabase.from('messages').update({ status: 'failed' }).eq('id', pending.id)
      }

      log.error(isTimeout ? 'envio sem resposta da Evolution — resultado desconhecido, mantido como enviando' : 'falha ao enviar mensagem', {
        instance: instanceName,
        conversationId,
        pendingId: pending.id,
        err,
      })
      return NextResponse.json(
        {
          ok: false,
          error: isTimeout
            ? 'Tempo esgotado ao enviar — resultado desconhecido, verifique antes de reenviar.'
            : 'Falha ao enviar mensagem',
        },
        { status: isTimeout ? 504 : 502 }
      )
    }

    const waMessageId = sent.messageId
    log.info('mensagem enviada', { instance: instanceName, conversationId, msgId: waMessageId })

    // A Evolution já aceitou a mensagem — erro ao persistir não falha a
    // resposta. Se o eco do webhook chegou antes e criou a própria linha,
    // a pendente duplicada é descartada (ver lib/outbound-message.ts).
    const finalized = await finalizePendingOutbound(pending.id, waMessageId)
    const message = finalized ?? { ...pending, wa_message_id: waMessageId, status: 'sent' }

    const { error: previewError } = await supabase
      .from('conversations')
      .update({
        last_message: content,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
    if (previewError) log.warn('mensagem enviada, mas a prévia da conversa não foi atualizada', { conversationId, err: previewError })

    return NextResponse.json({ ok: true, message })
  } catch (err) {
    log.error('erro inesperado no envio', { err })
    return NextResponse.json({ ok: false, error: 'Falha ao enviar mensagem' }, { status: 500 })
  }
}

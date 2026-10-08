import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createLogger } from './logger'

// Mensagens que NÓS enviamos têm duas origens de gravação concorrentes:
// quem enviou (rota de envio / motor de fluxos) e o eco do WhatsApp, que a
// Evolution manda pelo webhook (messages.upsert fromMe) às vezes ANTES de
// devolver a resposta HTTP do envio. Como messages.wa_message_id é UNIQUE,
// quem chega depois falhava com 23505: a mensagem pendente ficava presa em
// "enviando" ou a resposta do fluxo era registrada como enviada por humano.

const log = createLogger('outbound-message')

export const UNIQUE_VIOLATION = '23505'
// Janela para casar o eco com a mensagem pendente da mesma conversa.
const PENDING_MATCH_WINDOW_MS = 5 * 60 * 1000

export interface OutboundMessageRow {
  conversation_id: string
  wa_message_id: string | null
  content: string
  type: string
  direction: 'outbound'
  status: string
  sender_type: 'human' | 'ai' | 'flow' | null
}

// Webhook (eco fromMe): se existe uma mensagem pendente desta conversa que
// ainda não recebeu o id do WhatsApp, o eco é ELA — anexa o id em vez de
// criar outra linha. Imagens casam pelo tipo (a URL do eco é outra).
export async function attachEchoToPendingOutbound(input: {
  conversationId: string
  waMessageId: string
  content: string
  type: string
}): Promise<boolean> {
  const since = new Date(Date.now() - PENDING_MATCH_WINDOW_MS).toISOString()
  let query = supabaseAdmin
    .from('messages')
    .select('id')
    .eq('conversation_id', input.conversationId)
    .eq('direction', 'outbound')
    .eq('status', 'sending')
    .is('wa_message_id', null)
    .eq('type', input.type)
    .gte('created_at', since)
  if (input.type === 'text') query = query.eq('content', input.content)
  const { data: pending, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    log.warn('falha ao procurar mensagem pendente para o eco', { conversationId: input.conversationId, err: error })
    return false
  }
  if (!pending) return false

  const { data: attached, error: attachError } = await supabaseAdmin
    .from('messages')
    .update({ wa_message_id: input.waMessageId, status: 'sent' })
    .eq('id', pending.id)
    .is('wa_message_id', null)
    .select('id')
    .maybeSingle()
  if (attachError) {
    log.warn('falha ao anexar o eco à mensagem pendente', { conversationId: input.conversationId, msgId: input.waMessageId, err: attachError })
    return false
  }
  if (attached) log.debug('eco anexado à mensagem pendente', { conversationId: input.conversationId, msgId: input.waMessageId })
  return Boolean(attached)
}

// Motor de fluxos / recuperação Shopify: grava a mensagem enviada. Se o eco
// do webhook já gravou a mesma (23505), só corrige a autoria na linha
// existente — o conteúdo é o mesmo.
export async function recordOutboundMessage(row: OutboundMessageRow): Promise<void> {
  const { error } = await supabaseAdmin.from('messages').insert(row)
  if (!error) return
  if (error.code === UNIQUE_VIOLATION && row.wa_message_id) {
    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ sender_type: row.sender_type })
      .eq('wa_message_id', row.wa_message_id)
    if (updateError) log.warn('eco já gravado, mas falhou ao corrigir a autoria', { msgId: row.wa_message_id, err: updateError })
    else log.debug('eco do webhook chegou antes — autoria corrigida', { msgId: row.wa_message_id })
    return
  }
  // A mensagem FOI enviada ao cliente; só o registro falhou. Não lança
  // (reenviar duplicaria a mensagem), mas precisa aparecer no log.
  log.error('mensagem enviada mas não registrada no histórico', {
    conversationId: row.conversation_id,
    msgId: row.wa_message_id,
    type: row.type,
    err: error,
  })
}

// Rota de envio manual: a pendente recebe o id do WhatsApp. Se o eco já
// gravou uma linha própria com esse id, a pendente vira duplicata — some, e
// a linha do eco passa a ser a mensagem.
export async function finalizePendingOutbound(pendingId: string, waMessageId: string | null): Promise<Record<string, unknown> | null> {
  const { data: updated, error } = await supabaseAdmin
    .from('messages')
    .update({ wa_message_id: waMessageId, status: 'sent' })
    .eq('id', pendingId)
    .select()
    .single()
  if (!error) return updated as Record<string, unknown>

  if (error.code === UNIQUE_VIOLATION && waMessageId) {
    const { data: echo } = await supabaseAdmin
      .from('messages')
      .select()
      .eq('wa_message_id', waMessageId)
      .maybeSingle()
    const { error: deleteError } = await supabaseAdmin.from('messages').delete().eq('id', pendingId)
    if (deleteError) log.warn('eco duplicou a mensagem pendente e a pendente não pôde ser removida', { pendingId, msgId: waMessageId, err: deleteError })
    else log.debug('eco chegou antes da resposta do envio — pendente duplicada removida', { pendingId, msgId: waMessageId })
    return (echo as Record<string, unknown> | null) ?? null
  }

  log.error('mensagem enviada mas o registro não foi atualizado — fica como "enviando"', { pendingId, msgId: waMessageId, err: error })
  return null
}

import 'server-only'
import { supabaseAdmin } from './supabase-admin'

const WINDOW_MS = 24 * 60 * 60 * 1000

export class OutsideMessagingWindowError extends Error {
  constructor(public readonly conversationId: string) {
    super('Fora da janela de 24h de atendimento — envie um template aprovado para iniciar a conversa')
    this.name = 'OutsideMessagingWindowError'
  }
}

// A Meta só aceita texto livre dentro de 24h da última mensagem RECEBIDA do
// contato (não da última que nós enviamos — usar last_message_at reabriria a
// janela indevidamente a cada envio nosso). Sem last_inbound_at (conversa
// nunca recebeu mensagem, ex: contato importado manualmente) conta como fora
// da janela — mais seguro que assumir dentro.
export async function isWithinMessagingWindow(conversationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('last_inbound_at')
    .eq('id', conversationId)
    .maybeSingle()
  if (error || !data?.last_inbound_at) return false
  const lastInbound = new Date(data.last_inbound_at as string).getTime()
  if (Number.isNaN(lastInbound)) return false
  return Date.now() - lastInbound < WINDOW_MS
}

import 'server-only'
import { parseEvolutionMessage } from './evolution-message-content'
import { supabaseAdmin } from './supabase-admin'

// Importa o histórico de uma conversa direto da tabela "Message" da
// Evolution (mesmo Postgres). Usado pela sincronização por conversa e pela
// sincronização inicial da conta — antes cada uma tinha sua cópia, ambas com
// os mesmos três defeitos: parser próprio, busca sem @lid e insert em lote
// sem checar erro (um id repetido derrubava o lote todo, em silêncio).
//
// Requires:
//   GRANT SELECT ON TABLE public."Message"  TO service_role;
//   GRANT SELECT ON TABLE public."Instance" TO service_role;

const STATUS_MAP: Record<string, string> = {
  READ: 'read',
  PLAYED: 'read',
  DELIVERY_ACK: 'delivered',
  SERVER_ACK: 'sent',
  PENDING: 'sent',
}

interface EvoMessageRow {
  key: { id?: string; fromMe?: boolean; remoteJid?: string; participant?: string }
  message: Record<string, unknown> | null
  messageTimestamp: number
  status: string | null
  pushName?: string | null
}

export interface EvolutionHistoryResult {
  found: number
  added: number
  // Já existiam em OUTRA conversa (ex: duplicata @lid) — wa_message_id é único
  alreadyElsewhere: number
  ignored: number
  unknownFormat: number
}

export class EvolutionHistoryError extends Error {
  constructor(message: string, public readonly code: string | null) {
    super(message)
    this.name = 'EvolutionHistoryError'
  }
}

// A Evolution 2.3.x grava a conversa de contatos endereçados por LID com
// key.remoteJid = "<id>@lid" e o número em key.remoteJidAlt (2.3.0: senderPn).
// Buscar só por remoteJid perdia todas essas mensagens.
export function evolutionRemoteJidFilter(remoteJid: string): string {
  const quoted = `"${remoteJid.replace(/"/g, '')}"`
  return ['remoteJid', 'remoteJidAlt', 'senderPn']
    .map((field) => `key->>${field}.eq.${quoted}`)
    .join(',')
}

export async function importEvolutionHistory(input: {
  conversationId: string
  instanceId: string
  remoteJid: string
  limit?: number
}): Promise<EvolutionHistoryResult> {
  const result: EvolutionHistoryResult = { found: 0, added: 0, alreadyElsewhere: 0, ignored: 0, unknownFormat: 0 }
  const isGroup = input.remoteJid.endsWith('@g.us')

  const { data: evoMessages, error } = await supabaseAdmin
    .from('Message')
    .select('key, message, messageTimestamp, status, pushName')
    .eq('instanceId', input.instanceId)
    .or(evolutionRemoteJidFilter(input.remoteJid))
    .order('messageTimestamp', { ascending: false })
    .limit(input.limit ?? 30)
  if (error) throw new EvolutionHistoryError(`falha ao ler a tabela Message: ${error.message}`, error.code ?? null)
  if (!evoMessages?.length) return result
  result.found = evoMessages.length

  // Dedup barato contra o que já existe nesta conversa; o índice único cobre
  // o resto (inclusive mensagens gravadas em outra conversa).
  const waIds = evoMessages
    .map((m) => (m.key as { id?: string })?.id)
    .filter(Boolean) as string[]
  const { data: existing } = await supabaseAdmin
    .from('messages')
    .select('wa_message_id')
    .eq('conversation_id', input.conversationId)
    .in('wa_message_id', waIds)
  const existingIds = new Set((existing ?? []).map((m) => m.wa_message_id))

  const toInsert = (evoMessages as EvoMessageRow[])
    .filter((m) => m.key?.id && !existingIds.has(m.key.id))
    .flatMap((m) => {
      const parsed = parseEvolutionMessage(m.message)
      if (parsed.kind === 'ignore') {
        result.ignored += 1
        return []
      }
      if (parsed.kind === 'unknown') result.unknownFormat += 1
      const fromMe = m.key.fromMe === true
      return [{
        conversation_id: input.conversationId,
        wa_message_id: m.key.id as string,
        content: parsed.kind === 'content' ? parsed.content : '[mídia]',
        type: parsed.kind === 'content' ? parsed.type : 'media',
        direction: (fromMe ? 'outbound' : 'inbound') as 'outbound' | 'inbound',
        status: STATUS_MAP[m.status ?? ''] ?? (fromMe ? 'sent' : 'delivered'),
        created_at: m.messageTimestamp > 0
          ? new Date(m.messageTimestamp * 1000).toISOString()
          : new Date().toISOString(),
        sender_jid: isGroup && m.key.participant ? m.key.participant : null,
        sender_name: isGroup ? (m.pushName ?? null) : null,
      }]
    })
    // A consulta vem do mais novo para o mais antigo; grava em ordem cronológica.
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  if (toInsert.length === 0) return result

  // ON CONFLICT DO NOTHING: devolve só as linhas realmente gravadas.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('messages')
    .upsert(toInsert, { onConflict: 'wa_message_id', ignoreDuplicates: true })
    .select('id')
  if (insertError) throw new EvolutionHistoryError(`falha ao gravar histórico: ${insertError.message}`, insertError.code ?? null)
  result.added = inserted?.length ?? 0
  result.alreadyElsewhere = toInsert.length - result.added
  return result
}

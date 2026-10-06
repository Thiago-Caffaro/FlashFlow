import type { Message } from '@/types'

// Polling do chat busca só as mensagens mais recentes (?recent=N) — o
// histórico já carregado fica, e as recentes substituem as versões antigas
// pelo id (para pegar mudança de status: enviado → entregue → lido).
export const RECENT_MESSAGES_POLL_LIMIT = 40

export function mergeFetchedMessages(prev: Message[], fetched: Message[], partial: boolean): Message[] {
  if (fetched.length === 0 && prev.length > 0) return prev
  // Uma vez que a mensagem real (confirmada pelo banco) aparece com o
  // mesmo conteúdo/direção de uma otimista "sending" ainda pendente,
  // a otimista precisa sumir — senão o ícone de "enviando" nunca
  // troca pro de confirmado, mesmo com o envio já concluído.
  const stillPending = prev.filter((m) => (
    m.id.startsWith('temp-')
    && m.status === 'sending'
    && !fetched.some((real) => real.content === m.content && real.direction === m.direction)
  ))
  const fetchedIds = new Set(fetched.map((m) => m.id))
  const olderHistory = partial
    ? prev.filter((m) => !m.id.startsWith('temp-') && !fetchedIds.has(m.id))
    : []
  return [...olderHistory, ...fetched, ...stillPending].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  )
}

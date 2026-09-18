// Funções puras (sem 'server-only') para a UI: rótulo legível do status de um
// template da Meta e do motivo informado por ela.

export type TemplateStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'

const STATUS_LABELS: Record<TemplateStatus, string> = {
  pending: 'em análise',
  approved: 'aprovado',
  rejected: 'rejeitado',
  paused: 'pausado',
  disabled: 'desativado',
}

// Motivos de rejeição mais comuns que a Meta devolve (rejected_reason /
// reason do webhook); qualquer outro valor é mostrado como veio.
const REASON_LABELS: Record<string, string> = {
  INCORRECT_CATEGORY: 'categoria incorreta',
  INVALID_FORMAT: 'formato inválido',
  ABUSIVE_CONTENT: 'conteúdo abusivo',
  TAG_CONTENT_MISMATCH: 'conteúdo não condiz com a categoria',
  SCAM: 'suspeita de golpe',
}

export function templateStatusLabel(status: TemplateStatus, reason?: string | null): string {
  const label = STATUS_LABELS[status] ?? status
  const trimmed = reason?.trim()
  if (!trimmed) return label
  return `${label}: ${REASON_LABELS[trimmed.toUpperCase()] ?? trimmed}`
}

import 'server-only'

/** Mascara um número de telefone em logs, mantendo só os últimos 4 dígitos. */
export function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

/**
 * Mascara um JID do WhatsApp em logs mantendo o sufixo (que diz o tipo:
 * @s.whatsapp.net, @lid, @g.us) — o tipo é justamente o que importa ao
 * diagnosticar conversas duplicadas, o número não.
 */
export function maskJid(value: string | null | undefined): string {
  if (!value) return '-'
  const at = value.indexOf('@')
  const local = at >= 0 ? value.slice(0, at) : value
  const suffix = at >= 0 ? value.slice(at) : ''
  return `${redactPhone(local)}${suffix}`
}

/** Trunca texto livre (conteúdo de mensagem, prompts) para uso em logs. */
export function redactContent(value: string, maxLength = 40): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

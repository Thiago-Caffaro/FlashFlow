import 'server-only'

/** Mascara um número de telefone em logs, mantendo só os últimos 4 dígitos. */
export function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

/** Trunca texto livre (conteúdo de mensagem, prompts) para uso em logs. */
export function redactContent(value: string, maxLength = 40): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

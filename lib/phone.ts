export function normalizePhone(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 ? digits : raw
}

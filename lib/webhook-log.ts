const MAX = 30
const logs: Array<{ ts: string; event: string; instance: string; data: string }> = []

// Chaves que costumam carregar PII nos payloads da Evolution API
// (mensagens, telefones, nomes) — mascaradas antes de guardar em memória
// para exibição em /api/diagnostics.
const SENSITIVE_KEYS = new Set([
  'remotejid', 'participant', 'number', 'phone', 'pushname',
  'conversation', 'text', 'caption', 'content', 'base64',
])

function redactShallow(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redactShallow(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase()) && typeof val === 'string') {
        out[key] = '[redacted]'
      } else {
        out[key] = redactShallow(val, depth + 1)
      }
    }
    return out
  }
  return value
}

export function logWebhookEvent(event: string, instance: string, data: unknown) {
  const safeData = redactShallow(data)
  logs.unshift({ ts: new Date().toISOString(), event, instance, data: JSON.stringify(safeData).slice(0, 300) })
  if (logs.length > MAX) logs.pop()
}

export function getWebhookLogs() { return [...logs] }

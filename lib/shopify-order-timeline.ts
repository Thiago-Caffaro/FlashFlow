export interface ShopifyOrderTimelineEvent {
  id: string
  createdAt: string
  verb: string
  message: string
  author: string | null
  critical: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readableMessage(event: Record<string, unknown>): string {
  const preferred = stringValue(event.description) || stringValue(event.body) || stringValue(event.message)
  return preferred
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeShopifyOrderTimeline(value: unknown): ShopifyOrderTimelineEvent[] {
  const root = asRecord(value)
  const events = Array.isArray(root.events) ? root.events : Array.isArray(value) ? value : []
  return events
    .map(asRecord)
    .map((event) => {
      const verb = stringValue(event.verb).toLowerCase() || 'update'
      const createdAt = stringValue(event.created_at)
      return {
        id: String(event.id ?? `${createdAt}-${verb}`),
        createdAt,
        verb,
        message: readableMessage(event) || 'Atualização do pedido',
        author: stringValue(event.author) || null,
        critical: /(?:cancel|failure|declined|void)/i.test(verb),
      }
    })
    .filter((event) => event.createdAt && Number.isFinite(new Date(event.createdAt).getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

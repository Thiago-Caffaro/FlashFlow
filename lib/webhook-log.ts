const MAX = 30
const logs: Array<{ ts: string; event: string; instance: string; data: string }> = []

export function logWebhookEvent(event: string, instance: string, data: unknown) {
  logs.unshift({ ts: new Date().toISOString(), event, instance, data: JSON.stringify(data).slice(0, 300) })
  if (logs.length > MAX) logs.pop()
}

export function getWebhookLogs() { return [...logs] }

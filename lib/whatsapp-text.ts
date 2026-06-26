import 'server-only'
import { fetchEvolution } from './evolution-api'

export interface SendWhatsAppTextInput {
  instanceName: string
  number: string
  text: string
  timeoutMs?: number
}

export interface SendWhatsAppTextResult {
  messageId: string | null
  response: unknown
}

export async function sendWhatsAppText({
  instanceName,
  number,
  text,
  timeoutMs = 8000,
}: SendWhatsAppTextInput): Promise<SendWhatsAppTextResult> {
  const response = await fetchEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, text }),
  }, timeoutMs)

  if (!response.ok) {
    throw new Error(`Falha ao enviar WhatsApp (${response.status}): ${response.text.slice(0, 300)}`)
  }

  const body = response.body
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const key = record.key && typeof record.key === 'object' ? record.key as Record<string, unknown> : {}
  return {
    messageId: typeof key.id === 'string' ? key.id : null,
    response: body,
  }
}

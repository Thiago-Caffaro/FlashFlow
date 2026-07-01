import 'server-only'
import { fetchEvolution } from './evolution-api'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from './sandbox'
import { supabaseAdmin } from './supabase-admin'

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

async function persistSandboxOutboundMessage(text: string) {
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
    .eq('wa_id', SANDBOX_REMOTE_JID)
    .maybeSingle()
  if (!conversation) return

  await supabaseAdmin.from('messages').insert({
    conversation_id: conversation.id,
    wa_message_id: null,
    content: text,
    type: 'text',
    direction: 'outbound',
    status: 'sent',
    sender_type: 'ai',
  })
  await supabaseAdmin.from('conversations').update({
    last_message: text,
    last_message_at: new Date().toISOString(),
  }).eq('id', conversation.id)
}

export async function sendWhatsAppText({
  instanceName,
  number,
  text,
  timeoutMs = 8000,
}: SendWhatsAppTextInput): Promise<SendWhatsAppTextResult> {
  if (instanceName === SANDBOX_INSTANCE_NAME) {
    await persistSandboxOutboundMessage(text)
    return { messageId: null, response: { sandbox: true, number, text } }
  }

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

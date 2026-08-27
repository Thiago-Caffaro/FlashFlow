import 'server-only'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from './sandbox'
import { supabaseAdmin } from './supabase-admin'
import { dispatchSendText } from './whatsapp-dispatch'

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

async function persistSandboxOutboundMessage(text: string, phone: string) {
  // Multiple sandbox test contacts can exist — resolve by the target phone
  // first so the message lands in the right contact's conversation, falling
  // back to the original fixed test conversation when there's no phone match
  // (e.g. calls that aren't tied to a specific contact).
  let conversation: { id: string } | null = null
  if (phone) {
    const { data } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .eq('contact_phone', phone)
      .maybeSingle()
    conversation = data
  }
  if (!conversation) {
    const { data } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .eq('wa_id', SANDBOX_REMOTE_JID)
      .maybeSingle()
    conversation = data
  }
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
    await persistSandboxOutboundMessage(text, number)
    return { messageId: null, response: { sandbox: true, number, text } }
  }

  const result = await dispatchSendText(instanceName, number, text, timeoutMs)
  return { messageId: result.waMessageId, response: result.raw }
}

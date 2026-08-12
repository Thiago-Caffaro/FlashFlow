import 'server-only'
import { checkActiveSession, executeFlow } from './flow-engine'
import { supabaseAdmin } from './supabase-admin'
import { dispatchSendText } from './whatsapp-dispatch'

export async function executeTriggers(
  instanceName: string,
  remoteJid: string,
  conversationId: string,
  messageContent: string,
  messageType: string
) {
  if (messageType !== 'text') return

  const { data: triggers, error } = await supabaseAdmin
    .from('triggers')
    .select('*')
    .eq('instance_name', instanceName)
    .eq('source', 'message')

  if (error || !triggers || triggers.length === 0) return

  for (const trigger of triggers) {
    const valors = (trigger.valor ?? '')
      .split(',')
      .map((v: string) => v.trim().toLowerCase())
      .filter(Boolean)
    if (valors.length === 0) continue

    const isWildcard = valors.includes('*')
    const content = messageContent.toLowerCase()
    const matched = isWildcard || valors.some((v: string) =>
      trigger.tipo === 'exact' ? content === v : content.includes(v)
    )
    if (!matched) continue

    const delayMs: number = trigger.delay_ms ?? 0

    if (trigger.action === 'send_message') {
      const replyText: string = trigger.action_payload?.message ?? ''
      if (!replyText.trim()) continue

      const sendReply = async () => {
        try {
          const result = await dispatchSendText(instanceName, remoteJid, replyText)

          await supabaseAdmin.from('messages').insert({
            conversation_id: conversationId,
            wa_message_id: result.waMessageId,
            content: replyText,
            type: 'text',
            direction: 'outbound',
            status: 'sent',
          })
          await supabaseAdmin.from('conversations').update({
            last_message: replyText,
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          }).eq('id', conversationId)
        } catch (err) {
          console.error('Trigger send error:', err)
        }
      }

      if (delayMs > 0) setTimeout(sendReply, delayMs)
      else await sendReply()
    }

    if (trigger.action === 'flow') {
      const flowId: string = trigger.action_payload?.flow_id ?? ''
      if (!flowId) continue

      const runFlow = async () => {
        // Re-check session right before executing — handles race conditions and delayed triggers
        const activeSession = await checkActiveSession(instanceName, remoteJid)
        if (activeSession) return
        await executeFlow(flowId, { instanceName, remoteJid, conversationId, incomingMessage: messageContent })
          .catch((err) => console.error('executeFlow error:', err))
      }

      if (delayMs > 0) setTimeout(runFlow, delayMs)
      else await runFlow()
    }

    break // para no primeiro gatilho que bateu
  }
}

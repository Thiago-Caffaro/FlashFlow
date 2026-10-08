import 'server-only'
import type { SlackMention, SlackMessageSource } from '@/types'
import { buildHandoffMessage } from './slack-blocks'
import { slackPostMessage } from './slack-client'
import { getAppBaseUrl, getInstanceSlackSettings, getSlackCredentials } from './slack-settings'
import { supabaseAdmin } from './supabase-admin'

export class SlackNotConfiguredError extends Error {
  constructor(message = 'Slack não conectado — configure o token do bot na aba Integrações') {
    super(message)
    this.name = 'SlackNotConfiguredError'
  }
}

export interface SlackHandoffInput {
  instanceName: string
  source: SlackMessageSource
  title: string
  message: string
  originLabel: string
  conversationId?: string | null
  notificationId?: string | null
  // Vazios: usam o canal/menção padrão da conta (aba Integrações).
  channelId?: string | null
  mention?: SlackMention | null
  claimable?: boolean
}

export interface SlackHandoffResult {
  slackMessageId: string
  channelId: string
  ts: string
}

async function loadContact(conversationId: string | null | undefined) {
  if (!conversationId) return { name: null, phone: null }
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('contact_name, contact_phone')
    .eq('id', conversationId)
    .maybeSingle()
  return {
    name: typeof data?.contact_name === 'string' ? data.contact_name : null,
    phone: typeof data?.contact_phone === 'string' ? data.contact_phone : null,
  }
}

export async function postSlackHandoff(input: SlackHandoffInput): Promise<SlackHandoffResult> {
  const credentials = await getSlackCredentials()
  if (!credentials) throw new SlackNotConfiguredError()

  const needsDefaults = !input.channelId || !input.mention
  const settings = needsDefaults ? await getInstanceSlackSettings(input.instanceName) : null
  const channelId = input.channelId || settings?.channel_id
  if (!channelId) throw new Error('Nenhum canal do Slack definido — escolha um no node ou o canal padrão da conta em Integrações')
  const mention = input.mention ?? settings?.mention ?? 'none'

  const { data: row, error: insertError } = await supabaseAdmin
    .from('slack_messages')
    .insert({
      instance_name: input.instanceName,
      source: input.source,
      conversation_id: input.conversationId ?? null,
      notification_id: input.notificationId ?? null,
      channel_id: channelId,
    })
    .select('id')
    .single()
  if (insertError || !row) throw new Error(insertError?.message ?? 'Falha ao registrar mensagem do Slack')
  const slackMessageId = String(row.id)

  try {
    const contact = await loadContact(input.conversationId)
    const appUrl = await getAppBaseUrl()
    const message = buildHandoffMessage({
      slackMessageId,
      title: input.title,
      message: input.message,
      mention,
      instanceName: input.instanceName,
      originLabel: input.originLabel,
      contactName: contact.name,
      contactPhone: contact.phone,
      appUrl: appUrl ? `${appUrl}/` : null,
      createdAt: new Date(),
      claimable: input.claimable,
    })
    const posted = await slackPostMessage(credentials.botToken, { channel: channelId, ...message })
    await supabaseAdmin
      .from('slack_messages')
      .update({ channel_id: posted.channel, message_ts: posted.ts })
      .eq('id', slackMessageId)
    return { slackMessageId, channelId: posted.channel, ts: posted.ts }
  } catch (error) {
    await supabaseAdmin
      .from('slack_messages')
      .update({ error: error instanceof Error ? error.message.slice(0, 500) : 'Falha ao enviar ao Slack' })
      .eq('id', slackMessageId)
    throw error
  }
}

type ForwardSource = 'ai_escalation' | 'flow_notify' | 'outside_window'

const FORWARD_TOGGLE: Record<ForwardSource, 'forward_ai_escalation' | 'forward_flow_notify' | 'forward_outside_window'> = {
  ai_escalation: 'forward_ai_escalation',
  flow_notify: 'forward_flow_notify',
  outside_window: 'forward_outside_window',
}

const FORWARD_ORIGIN: Record<ForwardSource, string> = {
  ai_escalation: 'Agente de IA pediu atendimento humano',
  flow_notify: 'Node "Notificar" de um fluxo',
  outside_window: 'Mensagem não enviada — fora da janela de 24h (WhatsApp Cloud API)',
}

export const FORWARDABLE_NOTIFICATION_COLUMNS = 'id, instance_name, title, message, conversation_id'

export interface ForwardableNotification {
  id: string
  instance_name: string
  title: string
  message: string
  conversation_id: string | null
}

// Encaminhamento opcional de notificações internas. Só envia se o operador
// ligou esse tipo para a conta na aba Integrações. Nunca lança: uma falha no
// Slack não pode derrubar o fluxo nem a notificação interna que já existe.
export async function forwardNotificationToSlack(
  notification: ForwardableNotification,
  source: ForwardSource
): Promise<boolean> {
  try {
    const settings = await getInstanceSlackSettings(notification.instance_name)
    if (!settings[FORWARD_TOGGLE[source]] || !settings.channel_id) return false
    if (!(await getSlackCredentials())) return false
    await postSlackHandoff({
      instanceName: notification.instance_name,
      source,
      title: notification.title,
      message: notification.message,
      originLabel: FORWARD_ORIGIN[source],
      conversationId: notification.conversation_id,
      notificationId: notification.id,
      channelId: settings.channel_id,
      mention: settings.mention,
    })
    return true
  } catch (error) {
    console.error('[slack] falha ao encaminhar notificação:', error instanceof Error ? error.message : error)
    return false
  }
}

export interface SlackMessageRow {
  id: string
  instance_name: string
  conversation_id: string | null
  notification_id: string | null
  claimed_by_slack_user_id: string | null
  claimed_by_name: string | null
  claimed_at: string | null
}

const SLACK_MESSAGE_COLUMNS = 'id, instance_name, conversation_id, notification_id, claimed_by_slack_user_id, claimed_by_name, claimed_at'

// Atômico: só o primeiro clique vence (claimed_at IS NULL no UPDATE).
export async function claimSlackMessage(
  slackMessageId: string,
  claimer: { userId: string; name: string }
): Promise<{ claimed: boolean; row: SlackMessageRow | null }> {
  const { data, error } = await supabaseAdmin
    .from('slack_messages')
    .update({
      claimed_by_slack_user_id: claimer.userId,
      claimed_by_name: claimer.name,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', slackMessageId)
    .is('claimed_at', null)
    .select(SLACK_MESSAGE_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Falha ao registrar atendimento: ${error.message}`)
  if (data) return { claimed: true, row: data as SlackMessageRow }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('slack_messages')
    .select(SLACK_MESSAGE_COLUMNS)
    .eq('id', slackMessageId)
    .maybeSingle()
  if (loadError) throw new Error(`Falha ao consultar atendimento: ${loadError.message}`)
  return { claimed: false, row: existing as SlackMessageRow | null }
}

// Para a IA da conversa: com requires_human, o agente para de responder e a
// sessão aparece como escalada no FlashFlow.
export async function setConversationRequiresHuman(instanceName: string, remoteJid: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ai_sessions')
    .update({ requires_human: true, pending_messages: [] })
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
  if (error) throw new Error(`Falha ao transferir conversa para humano: ${error.message}`)
}

// Efeitos no FlashFlow de alguém ter assumido pelo Slack: a notificação
// interna fica lida e a conversa passa a atendimento humano.
export async function applySlackClaim(row: SlackMessageRow, claimerName: string): Promise<void> {
  const now = new Date().toISOString()
  if (row.notification_id) {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read_at: now })
      .eq('id', row.notification_id)
      .is('read_at', null)
    if (error) throw new Error(`Falha ao marcar notificação como lida: ${error.message}`)
  }
  if (row.conversation_id) {
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('instance_name, wa_id')
      .eq('id', row.conversation_id)
      .maybeSingle()
    if (error) throw new Error(`Falha ao consultar conversa: ${error.message}`)
    if (conversation?.wa_id && conversation.instance_name === row.instance_name) {
      await setConversationRequiresHuman(row.instance_name, String(conversation.wa_id))
    }
  }
  console.log(`[slack] atendimento assumido por ${claimerName} (slack_message ${row.id})`)
}

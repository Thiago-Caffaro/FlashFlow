import 'server-only'
import type { SlackMention, SlackNotificationSettings } from '@/types'
import { deleteSetting, getSetting, setSetting } from './app-settings'
import { supabaseAdmin } from './supabase-admin'

// Credenciais globais do app Slack — cifradas (AES-256-GCM) em app_settings,
// nunca devolvidas ao client.
const SLACK_BOT_TOKEN_KEY = 'slack_bot_token'
const SLACK_SIGNING_SECRET_KEY = 'slack_signing_secret'

export const SLACK_INTERACTIVITY_PATH = '/api/webhook/slack/interactivity'

export interface SlackCredentials {
  botToken: string
  signingSecret: string | null
}

export async function getSlackCredentials(): Promise<SlackCredentials | null> {
  const botToken = await getSetting(SLACK_BOT_TOKEN_KEY)
  if (!botToken) return null
  return { botToken, signingSecret: await getSetting(SLACK_SIGNING_SECRET_KEY) }
}

export async function getSlackSigningSecret(): Promise<string | null> {
  return getSetting(SLACK_SIGNING_SECRET_KEY)
}

export async function saveSlackCredentials(input: { botToken?: string; signingSecret?: string }): Promise<void> {
  if (input.botToken) await setSetting(SLACK_BOT_TOKEN_KEY, input.botToken)
  if (input.signingSecret) await setSetting(SLACK_SIGNING_SECRET_KEY, input.signingSecret)
}

export async function deleteSlackCredentials(): Promise<void> {
  await deleteSetting(SLACK_BOT_TOKEN_KEY)
  await deleteSetting(SLACK_SIGNING_SECRET_KEY)
}

// Mesma URL pública usada nos webhooks da Shopify.
export async function getAppBaseUrl(): Promise<string | null> {
  const appBaseUrl = (await getSetting('shopify_app_base_url')) ?? process.env.APP_BASE_URL ?? ''
  return appBaseUrl ? appBaseUrl.replace(/\/+$/, '') : null
}

export function isSlackMention(value: unknown): value is SlackMention {
  return value === 'none' || value === 'here' || value === 'channel'
}

export const DEFAULT_SLACK_SETTINGS: Omit<SlackNotificationSettings, 'instance_name'> = {
  channel_id: null,
  channel_name: null,
  mention: 'none',
  forward_ai_escalation: false,
  forward_flow_notify: false,
  forward_outside_window: false,
}

export async function getInstanceSlackSettings(instanceName: string): Promise<SlackNotificationSettings> {
  const { data, error } = await supabaseAdmin
    .from('slack_notification_settings')
    .select('instance_name, channel_id, channel_name, mention, forward_ai_escalation, forward_flow_notify, forward_outside_window')
    .eq('instance_name', instanceName)
    .maybeSingle()
  if (error) throw new Error(`Falha ao carregar configuração do Slack: ${error.message}`)
  return data
    ? data as SlackNotificationSettings
    : { instance_name: instanceName, ...DEFAULT_SLACK_SETTINGS }
}

export async function saveInstanceSlackSettings(
  instanceName: string,
  patch: Partial<Omit<SlackNotificationSettings, 'instance_name'>>
): Promise<SlackNotificationSettings> {
  const current = await getInstanceSlackSettings(instanceName)
  const { data, error } = await supabaseAdmin
    .from('slack_notification_settings')
    .upsert({
      ...current,
      ...patch,
      instance_name: instanceName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'instance_name' })
    .select('instance_name, channel_id, channel_name, mention, forward_ai_escalation, forward_flow_notify, forward_outside_window')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao salvar configuração do Slack')
  return data as SlackNotificationSettings
}

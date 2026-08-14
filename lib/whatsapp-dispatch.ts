import 'server-only'
import type { WhatsAppProvider } from '@/types'
import type { RenderedMessageContent } from './message-template'
import { getAccountProvider } from './whatsapp-account-provider'
import { evolutionAdapter } from './whatsapp-evolution-adapter'
import { cloudApiAdapter } from './whatsapp-cloud-adapter'

export interface SendResult {
  waMessageId: string | null
  raw: unknown
}

export interface WhatsAppProviderAdapter {
  sendText(instanceName: string, remoteJid: string, text: string, timeoutMs?: number): Promise<SendResult>
  sendImage(instanceName: string, remoteJid: string, imageUrl: string, caption?: string): Promise<SendResult>
  sendButtons(
    instanceName: string,
    remoteJid: string,
    content: RenderedMessageContent,
    opts?: { thumbnailUrl?: string }
  ): Promise<SendResult>
}

const adapters: Record<WhatsAppProvider, WhatsAppProviderAdapter> = {
  evolution: evolutionAdapter,
  cloud_api: cloudApiAdapter,
}

async function resolveAdapter(instanceName: string): Promise<WhatsAppProviderAdapter> {
  const provider = await getAccountProvider(instanceName)
  return adapters[provider]
}

export async function dispatchSendText(
  instanceName: string,
  remoteJid: string,
  text: string,
  timeoutMs?: number
): Promise<SendResult> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.sendText(instanceName, remoteJid, text, timeoutMs)
}

export async function dispatchSendImage(
  instanceName: string,
  remoteJid: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.sendImage(instanceName, remoteJid, imageUrl, caption)
}

export async function dispatchSendButtons(
  instanceName: string,
  remoteJid: string,
  content: RenderedMessageContent,
  opts?: { thumbnailUrl?: string }
): Promise<SendResult> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.sendButtons(instanceName, remoteJid, content, opts)
}

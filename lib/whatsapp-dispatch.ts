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

// Botões de resposta rápida de um template: cada payload volta no webhook
// quando o cliente toca no botão correspondente (ver
// extractCloudReplyPayload) — é como o fluxo sabe qual opção foi escolhida.
export interface SendTemplateOptions {
  quickReplyPayloads?: Array<{ index: number; payload: string }>
}

export interface TypingIndicatorOptions {
  // Id (wamid) da mensagem recebida mais recente do cliente — a Cloud API só
  // exibe o "digitando…" atrelado a ela. A Evolution ignora.
  inboundMessageId?: string | null
}

export interface WhatsAppProviderAdapter {
  sendText(instanceName: string, remoteJid: string, text: string, timeoutMs?: number): Promise<SendResult>
  // Exibe "digitando…" ao cliente enquanto a resposta é preparada. Pode demorar
  // a retornar (a Evolution segura a chamada durante o indicador) — quem chama
  // não deve aguardá-la no caminho da resposta.
  sendTypingIndicator(instanceName: string, remoteJid: string, options?: TypingIndicatorOptions): Promise<void>
  // Apaga o indicador quando nenhuma mensagem vai ser enviada para limpá-lo
  // (enviar uma resposta já o apaga sozinho).
  clearTypingIndicator(instanceName: string, remoteJid: string): Promise<void>
  sendImage(instanceName: string, remoteJid: string, imageUrl: string, caption?: string): Promise<SendResult>
  sendButtons(
    instanceName: string,
    remoteJid: string,
    content: RenderedMessageContent,
    opts?: { thumbnailUrl?: string }
  ): Promise<SendResult>
  sendTemplate(
    instanceName: string,
    remoteJid: string,
    templateName: string,
    language: string,
    parameters: string[],
    options?: SendTemplateOptions
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

export async function dispatchSendTypingIndicator(
  instanceName: string,
  remoteJid: string,
  options?: TypingIndicatorOptions
): Promise<void> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.sendTypingIndicator(instanceName, remoteJid, options)
}

export async function dispatchClearTypingIndicator(
  instanceName: string,
  remoteJid: string
): Promise<void> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.clearTypingIndicator(instanceName, remoteJid)
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

export async function dispatchSendTemplate(
  instanceName: string,
  remoteJid: string,
  templateName: string,
  language: string,
  parameters: string[],
  options?: SendTemplateOptions
): Promise<SendResult> {
  const adapter = await resolveAdapter(instanceName)
  return adapter.sendTemplate(instanceName, remoteJid, templateName, language, parameters, options)
}

// Evolution depende de um fork com patch de botões nativos (rollout
// controlado pela env var); a Cloud API tem botões interativos como recurso
// estável da própria Meta, sempre disponível.
export async function supportsNativeButtons(instanceName: string): Promise<boolean> {
  const provider = await getAccountProvider(instanceName)
  if (provider === 'cloud_api') return true
  return process.env.EVOLUTION_REPLY_BUTTONS_ENABLED === 'true'
}

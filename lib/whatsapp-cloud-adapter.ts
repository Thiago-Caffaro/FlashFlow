import 'server-only'
import { decodeCloudAccessToken, loadCloudCredentials, recordCloudSendError } from './whatsapp-cloud-credentials'
import { sendCloudButtons, sendCloudImage, sendCloudTemplate, sendCloudText, sendCloudTypingIndicator } from './whatsapp-cloud-client'
import type { SendResult, SendTemplateOptions, TypingIndicatorOptions, WhatsAppProviderAdapter } from './whatsapp-dispatch'
import type { RenderedMessageContent } from './message-template'

// Título de botão interativo tem teto de 20 caracteres na Cloud API —
// trunca em vez de rejeitar o envio inteiro por causa de um label longo.
const MAX_BUTTON_TITLE_LENGTH = 20

async function requireCredentials(instanceName: string) {
  const row = await loadCloudCredentials(instanceName)
  if (!row) throw new Error(`Conta "${instanceName}" não tem credenciais da WhatsApp Cloud API configuradas`)
  return row
}

async function sendText(
  instanceName: string,
  remoteJid: string,
  text: string,
  timeoutMs?: number
): Promise<SendResult> {
  const row = await requireCredentials(instanceName)
  try {
    const result = await sendCloudText(row.phone_number_id, decodeCloudAccessToken(row), remoteJid, text, timeoutMs)
    return { waMessageId: result.waMessageId, raw: result.raw }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar mensagem via WhatsApp Cloud API'
    await recordCloudSendError(instanceName, message)
    throw error
  }
}

// Falha ao exibir "digitando…" não é falha de envio da conta — por isso não
// passa por recordCloudSendError (que sinaliza a conta como com problema).
async function sendTypingIndicator(
  instanceName: string,
  _remoteJid: string,
  options: TypingIndicatorOptions = {}
): Promise<void> {
  // O indicador da Cloud API vai atrelado a uma mensagem recebida; sem ela
  // (ex.: fluxo retomado por job) não há como exibi-lo.
  if (!options.inboundMessageId) return
  const row = await requireCredentials(instanceName)
  await sendCloudTypingIndicator(row.phone_number_id, decodeCloudAccessToken(row), options.inboundMessageId, 5_000)
}

// A Meta não oferece cancelamento — o indicador some ao enviar uma resposta
// ou após ~25s.
async function clearTypingIndicator(): Promise<void> {}

async function sendImage(
  instanceName: string,
  remoteJid: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> {
  const row = await requireCredentials(instanceName)
  try {
    const result = await sendCloudImage(row.phone_number_id, decodeCloudAccessToken(row), remoteJid, imageUrl, caption)
    return { waMessageId: result.waMessageId, raw: result.raw }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar imagem via WhatsApp Cloud API'
    await recordCloudSendError(instanceName, message)
    throw error
  }
}

function truncateButtonTitle(label: string): string {
  return label.length > MAX_BUTTON_TITLE_LENGTH
    ? `${label.slice(0, MAX_BUTTON_TITLE_LENGTH - 1)}…`
    : label
}

async function sendButtons(
  instanceName: string,
  remoteJid: string,
  content: RenderedMessageContent,
  opts: { thumbnailUrl?: string } = {}
): Promise<SendResult> {
  const bodyText = content.message.trim()
  if (!bodyText) {
    throw new Error('Corpo da mensagem vazio — obrigatório para botões interativos da WhatsApp Cloud API')
  }
  if (content.replyButtons.length === 0) {
    throw new Error('Nenhum botão definido para envio interativo')
  }

  const row = await requireCredentials(instanceName)
  try {
    const result = await sendCloudButtons(row.phone_number_id, decodeCloudAccessToken(row), remoteJid, {
      headerText: content.title.trim() || undefined,
      headerImageUrl: opts.thumbnailUrl,
      bodyText,
      footerText: content.footer.trim() || undefined,
      buttons: content.replyButtons.slice(0, 3).map((button) => ({
        id: button.id,
        title: truncateButtonTitle(button.label),
      })),
    })
    return { waMessageId: result.waMessageId, raw: result.raw }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar botões via WhatsApp Cloud API'
    await recordCloudSendError(instanceName, message)
    throw error
  }
}

async function sendTemplate(
  instanceName: string,
  remoteJid: string,
  templateName: string,
  language: string,
  parameters: string[],
  options?: SendTemplateOptions
): Promise<SendResult> {
  const row = await requireCredentials(instanceName)
  try {
    const result = await sendCloudTemplate(row.phone_number_id, decodeCloudAccessToken(row), remoteJid, templateName, language, parameters, undefined, options)
    return { waMessageId: result.waMessageId, raw: result.raw }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar template via WhatsApp Cloud API'
    await recordCloudSendError(instanceName, message)
    throw error
  }
}

export const cloudApiAdapter: WhatsAppProviderAdapter = {
  sendText,
  sendTypingIndicator,
  clearTypingIndicator,
  sendImage,
  sendButtons,
  sendTemplate,
}

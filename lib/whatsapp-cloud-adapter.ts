import 'server-only'
import { decodeCloudAccessToken, loadCloudCredentials, recordCloudSendError } from './whatsapp-cloud-credentials'
import { sendCloudImage, sendCloudText } from './whatsapp-cloud-client'
import type { SendResult, WhatsAppProviderAdapter } from './whatsapp-dispatch'

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

function notSupported(feature: string): never {
  throw new Error(`${feature} ainda não suportado para contas WhatsApp Cloud API (chega em uma fase futura)`)
}

// sendButtons chega na Fase 3 do plano de suporte dual.
export const cloudApiAdapter: WhatsAppProviderAdapter = {
  sendText,
  sendImage,
  sendButtons: async () => notSupported('Envio de botões'),
}

import 'server-only'
import { decodeCloudAccessToken, loadCloudCredentials, recordCloudSendError } from './whatsapp-cloud-credentials'
import { sendCloudText } from './whatsapp-cloud-client'
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

function notSupported(feature: string): never {
  throw new Error(`${feature} ainda não suportado para contas WhatsApp Cloud API (chega em uma fase futura)`)
}

// sendImage/sendButtons chegam nas Fases 2 e 3 do plano de suporte dual —
// texto simples e o escopo da Fase 1.
export const cloudApiAdapter: WhatsAppProviderAdapter = {
  sendText,
  sendImage: async () => notSupported('Envio de imagem'),
  sendButtons: async () => notSupported('Envio de botões'),
}

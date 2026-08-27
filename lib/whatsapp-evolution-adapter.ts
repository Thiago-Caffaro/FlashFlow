import 'server-only'
import { fetchEvolution } from './evolution-api'
import type { RenderedMessageContent } from './message-template'
import type { SendResult, WhatsAppProviderAdapter } from './whatsapp-dispatch'

function extractWaMessageId(body: unknown): string | null {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const key = record.key && typeof record.key === 'object' ? record.key as Record<string, unknown> : {}
  return typeof key.id === 'string' ? key.id : null
}

async function sendText(
  instanceName: string,
  remoteJid: string,
  text: string,
  timeoutMs = 15_000
): Promise<SendResult> {
  const response = await fetchEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: remoteJid, text }),
  }, timeoutMs)
  if (!response.ok) {
    throw new Error(`Falha ao enviar mensagem via WhatsApp (${response.status}): ${response.text.slice(0, 300)}`)
  }
  return { waMessageId: extractWaMessageId(response.body), raw: response.body }
}

async function sendImage(
  instanceName: string,
  remoteJid: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> {
  const normalizedCaption = caption?.trim() ?? ''
  const response = await fetchEvolution(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: remoteJid,
      mediatype: 'image',
      media: imageUrl,
      ...(normalizedCaption ? { caption: normalizedCaption } : {}),
    }),
  }, 15_000)
  if (!response.ok) {
    throw new Error(`Falha ao enviar imagem do fluxo (${response.status}): ${response.text.slice(0, 300)}`)
  }
  return { waMessageId: extractWaMessageId(response.body), raw: response.body }
}

async function sendButtons(
  instanceName: string,
  remoteJid: string,
  content: RenderedMessageContent,
  opts: { thumbnailUrl?: string } = {}
): Promise<SendResult> {
  const response = await fetchEvolution(`/message/sendButtons/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: remoteJid,
      title: content.title.trim() || 'Escolha uma opcao',
      description: content.message,
      footer: content.footer,
      ...(opts.thumbnailUrl ? { thumbnailUrl: opts.thumbnailUrl } : {}),
      buttons: content.replyButtons.map((button) => ({
        type: 'reply',
        displayText: button.label,
        id: button.id,
      })),
    }),
  }, 15_000)
  if (!response.ok) {
    throw new Error(`Falha ao enviar botoes nativos (${response.status}): ${response.text.slice(0, 300)}`)
  }
  return { waMessageId: extractWaMessageId(response.body), raw: response.body }
}

// Templates são um conceito exclusivo da WhatsApp Cloud API (Meta) — a
// Evolution não tem equivalente. Nunca deveria ser chamado na prática (a UI
// só oferece modo Template para contas cloud_api), mas existe para manter a
// interface do dispatcher uniforme entre os dois provedores.
async function sendTemplate(): Promise<SendResult> {
  throw new Error('Templates não são suportados para contas Evolution')
}

export const evolutionAdapter: WhatsAppProviderAdapter = { sendText, sendImage, sendButtons, sendTemplate }

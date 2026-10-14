import 'server-only'
import { fetchEvolution } from './evolution-api'
import type { RenderedMessageContent } from './message-template'
import type { SendResult, WhatsAppProviderAdapter, TypingIndicatorClearOptions } from './whatsapp-dispatch'

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

// A rota /chat/sendPresence da Evolution é síncrona: envia a presença, segura a
// requisição pelo `delay` e só então manda "paused" sozinha. Um ciclo único e
// longo (ex.: 20s) tinha um efeito colateral: se a IA respondesse rápido e o
// cliente mandasse outra mensagem, o "paused" automático daquele ciclo antigo
// apagava o "digitando…" da resposta seguinte antes da hora.
//
// Por isso há um único laço por conversa, em ciclos curtos: uma nova resposta
// da IA na mesma conversa estende o laço em andamento em vez de abrir outro,
// e o laço para de renovar o "digitando…" quando a resposta sai. O "paused"
// do fim de cada ciclo só aparece entre um ciclo e o próximo (milissegundos)
// ou depois que o laço acabou.
const TYPING_INDICATOR_DURATION_MS = 20_000
const TYPING_CYCLE_MS = 5_000

interface TypingLoop {
  deadline: number
  holders: number
  stopped: boolean
}

// Laços ativos por instância + conversa (memória do processo).
const typingLoops = new Map<string, TypingLoop>()

function typingKey(instanceName: string, remoteJid: string): string {
  return `${instanceName}|${remoteJid}`
}

async function postPresence(
  instanceName: string,
  remoteJid: string,
  presence: 'composing' | 'paused',
  delay: number,
  timeoutMs: number
): Promise<void> {
  const response = await fetchEvolution(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: remoteJid, presence, delay }),
  }, timeoutMs)
  if (!response.ok) {
    throw new Error(`Falha ao enviar presença "${presence}" via WhatsApp (${response.status}): ${response.text.slice(0, 300)}`)
  }
}

// Só resolve quando o laço termina — quem chama não deve aguardar
// (ver startTypingIndicator em lib/flow-engine.ts).
async function sendTypingIndicator(instanceName: string, remoteJid: string): Promise<void> {
  const key = typingKey(instanceName, remoteJid)
  const deadline = Date.now() + TYPING_INDICATOR_DURATION_MS
  const running = typingLoops.get(key)
  if (running) {
    // Outra resposta da IA nesta conversa: estende o laço em andamento.
    running.deadline = Math.max(running.deadline, deadline)
    running.holders += 1
    running.stopped = false
    return
  }

  const loop: TypingLoop = { deadline, holders: 1, stopped: false }
  typingLoops.set(key, loop)
  try {
    while (!loop.stopped && Date.now() < loop.deadline) {
      const cycle = Math.min(TYPING_CYCLE_MS, loop.deadline - Date.now())
      if (cycle <= 0) break
      await postPresence(instanceName, remoteJid, 'composing', cycle, cycle + 5_000)
    }
  } finally {
    if (typingLoops.get(key) === loop) typingLoops.delete(key)
  }
}

// `replied`: a resposta já foi enviada (o WhatsApp apaga o "digitando…"
// sozinho) — só para de renovar. Sem resposta (falha, resposta vazia), manda
// "paused" na hora.
async function clearTypingIndicator(
  instanceName: string,
  remoteJid: string,
  options: TypingIndicatorClearOptions = {}
): Promise<void> {
  const loop = typingLoops.get(typingKey(instanceName, remoteJid))
  if (loop) {
    loop.holders = Math.max(0, loop.holders - 1)
    if (loop.holders === 0) loop.stopped = true
    // Outra resposta ainda em preparo nesta conversa: o "digitando…" continua.
    if (loop.holders > 0) return
  }
  if (options.replied) return
  await postPresence(instanceName, remoteJid, 'paused', 0, 8_000)
}

// Só para testes: zera os laços em memória.
export function _resetTypingLoopsForTests(): void {
  typingLoops.clear()
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

export const evolutionAdapter: WhatsAppProviderAdapter = {
  sendText,
  sendTypingIndicator,
  clearTypingIndicator,
  sendImage,
  sendButtons,
  sendTemplate,
}

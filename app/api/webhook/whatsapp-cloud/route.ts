import { NextRequest, NextResponse } from 'next/server'
import {
  executeFlow,
  checkActiveFlowRun,
  checkActiveSandboxFlowRunForRealInstance,
  checkActiveSession,
  handleActiveSession,
} from '@/lib/flow-engine'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import { normalizeReplyWithPayload } from '@/lib/message-template'
import { executeTriggers } from '@/lib/message-triggers'
import { loadCloudCredentialsByPhoneNumberId, type WhatsAppCloudCredentialsRow } from '@/lib/whatsapp-cloud-credentials'
import { resolveAndStoreCloudMedia } from '@/lib/whatsapp-cloud-media'
import { extractCloudInteractiveReplyText, extractCloudReplyPayload } from '@/lib/whatsapp-cloud-message-parser'
import { applyTemplateStatusUpdate, syncTemplatesForWaba } from '@/lib/whatsapp-templates'
import {
  WHATSAPP_CLOUD_SIGNATURE_HEADER,
  verifyCloudWebhookHandshake,
  verifyCloudWebhookSignature,
} from '@/lib/whatsapp-cloud-webhook-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createLogger } from '@/lib/logger'
import { UNIQUE_VIOLATION } from '@/lib/outbound-message'
import type { FlowReplyButton } from '@/types'

const log = createLogger('webhook-whatsapp-cloud')

// Status que a Meta manda para mensagens SAÍDAS por nós (não confundir com o
// status de mensagens recebidas, que não existe — toda mensagem inbound já
// chega "entregue").
const CLOUD_STATUS_MAP: Record<string, string> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
}

// Imagem é resolvida de verdade (Fase 2); botões interativos chegam na Fase 3
// — outros tipos viram um placeholder, mesma filosofia do webhook da
// Evolution para tipos ainda não suportados (vídeo/áudio/figurinha nunca
// baixam mídia lá também — paridade, não regressão).
const MEDIA_PLACEHOLDERS: Record<string, string> = {
  video: '[vídeo]',
  audio: '[áudio]',
  sticker: '[figurinha]',
}

// Tipos da Meta que não são conteúdo de chat: reação a outra mensagem,
// avisos de sistema (troca de número etc.) e "unsupported" (tipo que a
// própria Meta não entrega pela API). Antes viravam "[mídia]" e trocavam a
// prévia da conversa.
const NON_CONTENT_TYPES = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'request_welcome'])

type CloudContent = { content: string; type: string } | { ignore: string }

async function extractContent(
  message: Record<string, unknown>,
  credentials: WhatsAppCloudCredentialsRow
): Promise<CloudContent> {
  const msgType = typeof message.type === 'string' ? message.type : 'unknown'
  if (NON_CONTENT_TYPES.has(msgType)) return { ignore: msgType }
  const interactiveReply = extractCloudInteractiveReplyText(message)
  if (interactiveReply) {
    return { content: interactiveReply, type: 'text' }
  }
  if (msgType === 'text') {
    const body = (message.text as Record<string, unknown> | undefined)?.body
    return { content: typeof body === 'string' && body.trim() ? body : '[mensagem vazia]', type: 'text' }
  }
  if (msgType === 'image') {
    const image = message.image as Record<string, unknown> | undefined
    const mediaId = typeof image?.id === 'string' ? image.id : ''
    const caption = typeof image?.caption === 'string' && image.caption.trim() ? image.caption : ''
    const mediaUrl = mediaId ? await resolveAndStoreCloudMedia(mediaId, credentials) : null
    return { content: mediaUrl ?? (caption || '[imagem]'), type: 'image' }
  }
  if (msgType === 'document') {
    const documentNode = message.document as Record<string, unknown> | undefined
    const name = typeof documentNode?.filename === 'string' && documentNode.filename.trim() ? documentNode.filename : 'Documento'
    return { content: `📄 ${name}`, type: 'media' }
  }
  if (msgType === 'location') {
    const location = message.location as Record<string, unknown> | undefined
    const label = typeof location?.name === 'string' ? location.name : typeof location?.address === 'string' ? location.address : ''
    return { content: `📍 Localização${label ? `: ${label}` : ''}`, type: 'media' }
  }
  if (msgType === 'contacts') return { content: '👤 Contato compartilhado', type: 'media' }
  const placeholder = MEDIA_PLACEHOLDERS[msgType]
  if (placeholder) return { content: placeholder, type: msgType }
  log.warn('tipo de mensagem desconhecido — salvo como [mídia]', { instance: credentials.instance_name, msgType }, { throttleKey: `unknown:${msgType}` })
  return { content: '[mídia]', type: 'media' }
}

// A Meta manda o motivo de uma entrega que falhou em errors[] (ex: 131047
// fora da janela de 24h, 131026 número sem WhatsApp, 131049 limite de
// marketing). Antes o status só virava "failed", sem nenhum porquê.
function describeCloudStatusError(status: Record<string, unknown>): Record<string, unknown> {
  const errors = Array.isArray(status.errors) ? status.errors as Array<Record<string, unknown>> : []
  const first = errors[0] ?? {}
  const errorData = first.error_data && typeof first.error_data === 'object' ? first.error_data as Record<string, unknown> : {}
  return {
    code: first.code,
    title: first.title,
    details: errorData.details ?? first.message,
  }
}

async function applyStatusUpdate(instanceName: string, status: Record<string, unknown>): Promise<void> {
  const waMessageId = typeof status.id === 'string' ? status.id : ''
  const rawStatus = typeof status.status === 'string' ? status.status : ''
  const mapped = CLOUD_STATUS_MAP[rawStatus]
  if (!waMessageId || !mapped) return
  if (mapped === 'failed') {
    log.warn('Meta não entregou a mensagem', { instance: instanceName, msgId: waMessageId, ...describeCloudStatusError(status) })
  }
  const { error } = await supabaseAdmin.from('messages').update({ status: mapped }).eq('wa_message_id', waMessageId)
  if (error) {
    log.warn('falha ao atualizar status de entrega', { instance: instanceName, msgId: waMessageId, status: mapped, err: error }, { throttleKey: `status-update:${error.code}` })
  }
}

async function processInboundMessage(
  instanceName: string,
  message: Record<string, unknown>,
  contacts: Array<Record<string, unknown>>,
  credentials: WhatsAppCloudCredentialsRow
): Promise<void> {
  const waMessageId = typeof message.id === 'string' ? message.id : ''
  const fromDigits = typeof message.from === 'string' ? message.from : ''
  if (!waMessageId || !fromDigits) return

  // Dedup — a Meta pode reentregar o mesmo evento. O índice único em
  // wa_message_id é a garantia de verdade; esta consulta poupa o download.
  const { data: existingMsg, error: dedupError } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle()
  if (dedupError) log.warn('falha na checagem de duplicidade — seguindo; o índice único protege', { instance: instanceName, msgId: waMessageId, err: dedupError })
  if (existingMsg) return

  // Prefere contacts[].wa_id (valor canônico) a message.from — a Meta
  // documenta que podem divergir por normalização de número em alguns
  // países, e wa_id é o valor certo para responder.
  const contactEntry = contacts.find((c) => c.wa_id === fromDigits) ?? contacts[0]
  const remoteJid = typeof contactEntry?.wa_id === 'string' ? contactEntry.wa_id : fromDigits
  const profile = contactEntry?.profile as Record<string, unknown> | undefined
  const contactName = typeof profile?.name === 'string' ? profile.name : null

  const extracted = await extractContent(message, credentials)
  if ('ignore' in extracted) {
    log.debug('mensagem sem conteúdo de chat ignorada', { instance: instanceName, msgId: waMessageId, msgType: extracted.ignore })
    return
  }
  const { content, type } = extracted

  // 1) Conversa sem mexer na prévia — a prévia só muda depois que a
  //    mensagem existe (antes, falha no insert deixava prévia sem mensagem).
  const { data: conversation, error: convError } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        wa_id: remoteJid,
        instance_name: instanceName,
        contact_phone: remoteJid,
        ...(contactName ? { contact_name: contactName } : {}),
      },
      { onConflict: 'wa_id, instance_name' }
    )
    .select()
    .single()

  if (convError || !conversation) {
    // Lança para o POST devolver 500: a Meta reentrega o evento.
    throw new Error(`falha ao gravar conversa: ${convError?.message ?? 'sem retorno'}`)
  }

  // 2) Mensagem.
  const { error: msgError } = await supabaseAdmin.from('messages').insert({
    conversation_id: conversation.id,
    wa_message_id: waMessageId,
    content,
    type,
    direction: 'inbound',
    status: 'delivered',
    sender_type: null,
  })
  if (msgError) {
    if (msgError.code === UNIQUE_VIOLATION) {
      log.debug('mensagem já gravada por entrega concorrente', { instance: instanceName, msgId: waMessageId })
      return
    }
    throw new Error(`falha ao gravar mensagem ${waMessageId}: ${msgError.code ?? ''} ${msgError.message}`)
  }

  // 3) Prévia + não lidas, só agora que a mensagem existe.
  const { error: previewError } = await supabaseAdmin
    .from('conversations')
    .update({
      last_message: type === 'image' ? '[imagem]' : content,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count ?? 0) + 1,
    })
    .eq('id', conversation.id)
  if (previewError) log.warn('mensagem gravada, mas a prévia da conversa não foi atualizada', { instance: instanceName, conversationId: conversation.id, err: previewError })

  log.info('mensagem gravada', { instance: instanceName, conversationId: conversation.id, msgId: waMessageId, direction: 'in', type })

  if (type !== 'text') return

  // Mesma cascata, já agnóstica de provedor, do webhook da Evolution:
  // flow pausado (real ou sandbox com envio real) → sessão de IA ativa →
  // gatilhos por palavra-chave. Fire-and-forget — a resposta HTTP do
  // webhook não espera o fluxo terminar.
  void (async () => {
    try {
      let flowRun = await checkActiveFlowRun(instanceName, remoteJid)
      let flowRunIsSandboxFallback = false
      if (!flowRun) {
        flowRun = await checkActiveSandboxFlowRunForRealInstance(instanceName, remoteJid)
        flowRunIsSandboxFallback = Boolean(flowRun)
      }
      if (flowRun) {
        const variables = flowRun.variables && typeof flowRun.variables === 'object'
          ? flowRun.variables as Record<string, unknown>
          : {}
        const replyButtons = Array.isArray(variables.replyButtons)
          ? variables.replyButtons as FlowReplyButton[]
          : []
        const normalizedContent = normalizeReplyWithPayload(content, extractCloudReplyPayload(message), replyButtons)
        await executeFlow(flowRun.flow_id, {
          instanceName: flowRunIsSandboxFallback ? SANDBOX_INSTANCE_NAME : instanceName,
          remoteJid,
          conversationId: flowRunIsSandboxFallback ? flowRun.conversation_id : conversation.id,
          incomingMessage: normalizedContent,
          inboundWaMessageId: waMessageId,
          orderId: typeof variables.orderId === 'string' ? variables.orderId : undefined,
          checkoutId: typeof variables.checkoutId === 'string' ? variables.checkoutId : undefined,
          flowRunId: typeof flowRun.id === 'string' ? flowRun.id : undefined,
          isSandbox: flowRunIsSandboxFallback ? true : undefined,
          realSendInstanceName: flowRunIsSandboxFallback ? instanceName : undefined,
        }, flowRun.node_id)
      } else {
        const session = await checkActiveSession(instanceName, remoteJid)
        if (session) {
          await handleActiveSession(session, {
            instanceName,
            remoteJid,
            conversationId: conversation.id,
            incomingMessage: content,
            inboundWaMessageId: waMessageId,
          })
        } else {
          await executeTriggers(instanceName, remoteJid, conversation.id, content, type, waMessageId)
        }
      }
    } catch (err) {
      // Roda depois da resposta HTTP — sem log, falha na automação seria invisível.
      log.error('falha na automação após mensagem recebida', { instance: instanceName, conversationId: conversation.id, msgId: waMessageId, err })
    }
  })()
}

async function processMessagesChange(value: Record<string, unknown>): Promise<void> {
  const metadata = value.metadata as Record<string, unknown> | undefined
  const phoneNumberId = typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : ''
  if (!phoneNumberId) return

  const credentials = await loadCloudCredentialsByPhoneNumberId(phoneNumberId)
  if (!credentials) {
    log.error('evento de um número sem conta cadastrada — mensagens descartadas', { phoneNumberId }, { throttleKey: `no-account:${phoneNumberId}` })
    return
  }
  const instanceName = credentials.instance_name

  const contacts = Array.isArray(value.contacts) ? value.contacts as Array<Record<string, unknown>> : []
  const messages = Array.isArray(value.messages) ? value.messages as Array<Record<string, unknown>> : []
  const statuses = Array.isArray(value.statuses) ? value.statuses as Array<Record<string, unknown>> : []

  for (const status of statuses) {
    await applyStatusUpdate(instanceName, status)
  }
  for (const message of messages) {
    await processInboundMessage(instanceName, message, contacts, credentials)
  }
}

interface WebhookChange {
  field: string
  value: Record<string, unknown>
  // entry.id: ID da WABA que gerou o evento.
  entryId: string
}

function extractChanges(body: unknown): WebhookChange[] {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const entries = Array.isArray(record.entry) ? record.entry as Array<Record<string, unknown>> : []
  const result: WebhookChange[] = []
  for (const entry of entries) {
    const entryId = entry.id != null ? String(entry.id) : ''
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : []
    for (const change of changes) {
      if (typeof change.field !== 'string') continue
      if (change.value && typeof change.value === 'object') {
        result.push({ field: change.field, value: change.value as Record<string, unknown>, entryId })
      }
    }
  }
  return result
}

// Status de template em tempo real (aprovado/rejeitado/pausado...) — evita
// depender do botão "Sincronizar". Best-effort: uma falha aqui nunca pode
// derrubar o processamento de mensagens que vieram no mesmo POST (um 500
// faria a Meta reentregar tudo).
async function processTemplateStatusChange(change: WebhookChange): Promise<void> {
  try {
    const metaTemplateId = change.value.message_template_id != null ? String(change.value.message_template_id) : ''
    const event = typeof change.value.event === 'string' ? change.value.event : ''
    if (!metaTemplateId || !event) return

    const result = await applyTemplateStatusUpdate({
      metaTemplateId,
      event,
      reason: typeof change.value.reason === 'string' ? change.value.reason : null,
    })
    log.info('status de template atualizado', { event, name: String(change.value.message_template_name ?? ''), result })
    // Template criado no Gerenciador do WhatsApp depois da última
    // sincronização: ainda não existe aqui, então busca da Meta.
    if (result === 'unknown') await syncTemplatesForWaba(change.entryId)
  } catch (error) {
    log.error('falha ao processar status de template', { err: error })
  }
}

// account_update traz o motivo real de uma desconexão do número
// (PARTNER_REMOVED + disconnection_info) — sem isso, a única pista era o
// erro no primeiro envio. Só registra em log; não altera estado.
function logAccountUpdate(change: WebhookChange): void {
  const info = change.value.disconnection_info && typeof change.value.disconnection_info === 'object'
    ? change.value.disconnection_info as Record<string, unknown>
    : null
  log.warn('account_update da Meta', {
    event: String(change.value.event ?? ''),
    waba: change.entryId,
    reason: String(info?.reason ?? ''),
    initiatedBy: String(info?.initiated_by ?? ''),
  })
}

// GET — handshake de verificação exigido pela Meta ao registrar o webhook no
// App Dashboard (WhatsApp → Configuration).
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const verifyToken = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (!challenge || !verifyCloudWebhookHandshake(mode, verifyToken)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  return new NextResponse(challenge, { status: 200 })
}

// POST — eventos de mensagem/status. Autenticado por HMAC-SHA256 do corpo
// cru (X-Hub-Signature-256), não pelo header customizado que a Evolution usa.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Todo POST em debug (inclui os 3 status — enviado/entregue/lido — de
  // cada mensagem que sai). A rejeição carrega o mesmo contexto em warn,
  // para "a requisição chegou mas foi recusada" nunca ficar sem rastro.
  const hasSignatureHeader = Boolean(req.headers.get(WHATSAPP_CLOUD_SIGNATURE_HEADER))
  const secretConfigured = Boolean(process.env.WHATSAPP_CLOUD_APP_SECRET)
  log.debug('POST recebido', { bodyLen: rawBody.length, hasSignatureHeader, secretConfigured })

  if (!verifyCloudWebhookSignature(rawBody, req.headers.get(WHATSAPP_CLOUD_SIGNATURE_HEADER))) {
    log.warn('assinatura inválida ou ausente — rejeitado com 401', { bodyLen: rawBody.length, hasSignatureHeader, secretConfigured }, { throttleKey: 'bad-signature' })
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    for (const change of extractChanges(body)) {
      if (change.field === 'messages') {
        await processMessagesChange(change.value)
      } else if (change.field === 'message_template_status_update') {
        await processTemplateStatusChange(change)
      } else if (change.field === 'account_update') {
        logAccountUpdate(change)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    // 500 faz a Meta reentregar o lote; o que já foi gravado é deduplicado.
    log.error('falha ao processar evento — devolvido 500 para a Meta reentregar', { err })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

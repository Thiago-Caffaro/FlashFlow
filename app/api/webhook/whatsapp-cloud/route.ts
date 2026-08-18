import { NextRequest, NextResponse } from 'next/server'
import {
  executeFlow,
  checkActiveFlowRun,
  checkActiveSandboxFlowRunForRealInstance,
  checkActiveSession,
  handleActiveSession,
} from '@/lib/flow-engine'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import { normalizeReplyInput } from '@/lib/message-template'
import { executeTriggers } from '@/lib/message-triggers'
import { loadCloudCredentialsByPhoneNumberId, type WhatsAppCloudCredentialsRow } from '@/lib/whatsapp-cloud-credentials'
import { resolveAndStoreCloudMedia } from '@/lib/whatsapp-cloud-media'
import {
  WHATSAPP_CLOUD_SIGNATURE_HEADER,
  verifyCloudWebhookHandshake,
  verifyCloudWebhookSignature,
} from '@/lib/whatsapp-cloud-webhook-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { FlowReplyButton } from '@/types'

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

async function extractContent(
  message: Record<string, unknown>,
  credentials: WhatsAppCloudCredentialsRow
): Promise<{ content: string; type: string }> {
  const msgType = typeof message.type === 'string' ? message.type : 'unknown'
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
  const placeholder = MEDIA_PLACEHOLDERS[msgType]
  return placeholder ? { content: placeholder, type: msgType } : { content: '[mídia]', type: 'media' }
}

async function applyStatusUpdate(status: Record<string, unknown>): Promise<void> {
  const waMessageId = typeof status.id === 'string' ? status.id : ''
  const rawStatus = typeof status.status === 'string' ? status.status : ''
  const mapped = CLOUD_STATUS_MAP[rawStatus]
  if (!waMessageId || !mapped) return
  await supabaseAdmin.from('messages').update({ status: mapped }).eq('wa_message_id', waMessageId)
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

  // Dedup — a Meta pode reentregar o mesmo evento.
  const { data: existingMsg } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle()
  if (existingMsg) return

  // Prefere contacts[].wa_id (valor canônico) a message.from — a Meta
  // documenta que podem divergir por normalização de número em alguns
  // países, e wa_id é o valor certo para responder.
  const contactEntry = contacts.find((c) => c.wa_id === fromDigits) ?? contacts[0]
  const remoteJid = typeof contactEntry?.wa_id === 'string' ? contactEntry.wa_id : fromDigits
  const profile = contactEntry?.profile as Record<string, unknown> | undefined
  const contactName = typeof profile?.name === 'string' ? profile.name : null

  const { content, type } = await extractContent(message, credentials)

  const { data: conversation, error: convError } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        wa_id: remoteJid,
        instance_name: instanceName,
        contact_phone: remoteJid,
        ...(contactName ? { contact_name: contactName } : {}),
        last_message: type === 'image' ? '[imagem]' : content,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'wa_id, instance_name' }
    )
    .select()
    .single()

  if (convError || !conversation) {
    console.error('[webhook-whatsapp-cloud] erro ao upsert conversa:', convError?.message)
    return
  }

  await supabaseAdmin
    .from('conversations')
    .update({ unread_count: (conversation.unread_count ?? 0) + 1 })
    .eq('id', conversation.id)

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
    console.error('[webhook-whatsapp-cloud] erro ao inserir mensagem:', msgError.message)
    return
  }
  console.log(`[webhook-whatsapp-cloud] mensagem salva conv="${conversation.id}" content="${content.slice(0, 60)}"`)

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
        const normalizedContent = normalizeReplyInput(content, replyButtons)
        await executeFlow(flowRun.flow_id, {
          instanceName: flowRunIsSandboxFallback ? SANDBOX_INSTANCE_NAME : instanceName,
          remoteJid,
          conversationId: flowRunIsSandboxFallback ? flowRun.conversation_id : conversation.id,
          incomingMessage: normalizedContent,
          orderId: typeof variables.orderId === 'string' ? variables.orderId : undefined,
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
          })
        } else {
          await executeTriggers(instanceName, remoteJid, conversation.id, content, type)
        }
      }
    } catch (err) {
      console.error('[webhook-whatsapp-cloud] session/trigger error:', err)
    }
  })()
}

async function processMessagesChange(value: Record<string, unknown>): Promise<void> {
  const metadata = value.metadata as Record<string, unknown> | undefined
  const phoneNumberId = typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : ''
  if (!phoneNumberId) return

  const credentials = await loadCloudCredentialsByPhoneNumberId(phoneNumberId)
  if (!credentials) {
    console.error(`[webhook-whatsapp-cloud] phone_number_id="${phoneNumberId}" sem conta correspondente`)
    return
  }
  const instanceName = credentials.instance_name

  const contacts = Array.isArray(value.contacts) ? value.contacts as Array<Record<string, unknown>> : []
  const messages = Array.isArray(value.messages) ? value.messages as Array<Record<string, unknown>> : []
  const statuses = Array.isArray(value.statuses) ? value.statuses as Array<Record<string, unknown>> : []

  for (const status of statuses) {
    await applyStatusUpdate(status)
  }
  for (const message of messages) {
    await processInboundMessage(instanceName, message, contacts, credentials)
  }
}

function extractChangesValues(body: unknown): Array<Record<string, unknown>> {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const entries = Array.isArray(record.entry) ? record.entry as Array<Record<string, unknown>> : []
  const values: Array<Record<string, unknown>> = []
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : []
    for (const change of changes) {
      if (change.field !== 'messages') continue
      if (change.value && typeof change.value === 'object') {
        values.push(change.value as Record<string, unknown>)
      }
    }
  }
  return values
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

  if (!verifyCloudWebhookSignature(rawBody, req.headers.get(WHATSAPP_CLOUD_SIGNATURE_HEADER))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const values = extractChangesValues(body)
    for (const value of values) {
      await processMessagesChange(value)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[webhook-whatsapp-cloud] erro:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

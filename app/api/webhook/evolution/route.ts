import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  executeFlow,
  checkActiveFlowRun,
  checkActiveSandboxFlowRunForRealInstance,
  checkActiveSession,
  handleActiveSession,
} from '@/lib/flow-engine'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import { cacheQr, clearQr } from '@/lib/qr-cache'
import { logWebhookEvent } from '@/lib/webhook-log'
import {
  exceedsMaxEvolutionWebhookBodySize,
  EVOLUTION_WEBHOOK_SECRET_HEADER,
  fetchEvolution,
  readEvolutionWebhookBody,
  verifyEvolutionWebhookSecret,
} from '@/lib/evolution-api'
import { parseEvolutionMessage, previewForParsedMessage } from '@/lib/evolution-message-content'
import { normalizeReplyInput } from '@/lib/message-template'
import { executeTriggers } from '@/lib/message-triggers'
import { storeBase64Media } from '@/lib/media-storage'
// UNIQUE_VIOLATION (23505): o mesmo wa_message_id já gravado por uma entrega
// concorrente do mesmo evento (a Evolution reenvia quando demoramos).
import { attachEchoToPendingOutbound, UNIQUE_VIOLATION } from '@/lib/outbound-message'
import { createLogger } from '@/lib/logger'
import { maskJid } from '@/lib/redact'
import type { FlowReplyButton } from '@/types'

const log = createLogger('webhook-evolution')

const MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

// Baixa a mídia pela Evolution (webhook_base64 está desligado) e guarda no
// storage. Falha devolve null — a mensagem é salva com o placeholder e a
// bolha do chat tenta de novo sob demanda via /api/media/proxy —, mas
// sempre com log: antes, "imagem não carrega" não deixava rastro nenhum.
async function downloadAndStoreMedia(
  fullMessageData: Record<string, unknown>,
  messageId: string,
  instanceName: string
): Promise<string | null> {
  try {
    const response = await fetchEvolution(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fullMessageData }),
      },
      MEDIA_DOWNLOAD_TIMEOUT_MS
    )
    const body = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {}
    const base64 = typeof body.base64 === 'string' ? body.base64 : ''
    if (!response.ok || !base64) {
      log.warn('download de mídia falhou na Evolution — salvo com placeholder', {
        instance: instanceName,
        msgId: messageId,
        status: response.status,
        body: response.text.slice(0, 200),
      }, { throttleKey: `media-download:${instanceName}:${response.status}` })
      return null
    }
    const mimetype = typeof body.mimetype === 'string' ? body.mimetype : 'image/jpeg'
    return storeBase64Media(base64, mimetype, messageId)
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    log.warn(timedOut ? 'download de mídia expirou na Evolution' : 'download de mídia falhou', {
      instance: instanceName,
      msgId: messageId,
      err: error,
    }, { throttleKey: `media-download:${instanceName}:${timedOut ? 'timeout' : 'error'}` })
    return null
  }
}

const GHOST_CONVERSATION_WINDOW_MS = 60_000

async function removeConversationIfJustCreatedAndEmpty(
  conversation: { id: string; last_message?: string | null; created_at?: string | null },
  instanceName: string,
  waMessageId: string
): Promise<void> {
  const createdAt = conversation.created_at ? new Date(conversation.created_at).getTime() : 0
  if (conversation.last_message || Date.now() - createdAt > GHOST_CONVERSATION_WINDOW_MS) return
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
  if (error || (count ?? 0) > 0) return
  const { error: deleteError } = await supabase.from('conversations').delete().eq('id', conversation.id)
  if (deleteError) log.warn('conversa vazia criada pela entrega duplicada não pôde ser removida', { instance: instanceName, conversationId: conversation.id, err: deleteError })
  else log.info('entrega duplicada criou conversa vazia — removida', { instance: instanceName, conversationId: conversation.id, msgId: waMessageId })
}

// Status da Evolution API → nosso sistema
const EVO_STATUS_MAP: Record<string, string> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  '2': 'sent',
  '3': 'delivered',
  '4': 'read',
  '5': 'read',
}

export async function POST(req: NextRequest) {
  // Autenticação do webhook precisa acontecer antes de qualquer parsing de payload,
  // log de conteúdo ou acesso ao banco. A Evolution API 2.3.7 permite configurar
  // headers customizados por instância (ver webhookConfigPayload em lib/evolution-api.ts),
  // que ela reenvia em todo callback — validamos esse header em tempo constante aqui.
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return unauthorized()
  }

  if (exceedsMaxEvolutionWebhookBodySize(req.headers.get('content-length'))) {
    return unauthorized()
  }

  if (!verifyEvolutionWebhookSecret(req.headers.get(EVOLUTION_WEBHOOK_SECRET_HEADER))) {
    return unauthorized()
  }

  const rawBody = await readEvolutionWebhookBody(req)
  if (rawBody === null) {
    return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
  }

  let body
  try {
    body = JSON.parse(rawBody)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Webhook payload must be an object')
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const event = typeof body.event === 'string' ? body.event.toLowerCase() : ''
    const evtInstance = typeof body.instance === 'string' ? body.instance : ''
    log.debug('evento recebido', { event, instance: evtInstance })
    logWebhookEvent(event, evtInstance, body.data ?? {})

    if (event === 'qrcode.updated' || event === 'qrcode_updated') {
      const instanceName = evtInstance
      const qr: string | null =
        body.data?.qrcode?.base64 ??
        body.data?.base64 ??
        (typeof body.data?.qrcode === 'string' ? body.data.qrcode : null) ??
        null
      log.debug('qrcode atualizado', { instance: instanceName, hasQr: Boolean(qr) })
      if (instanceName && qr) cacheQr(instanceName, qr)
      return NextResponse.json({ ok: true })
    }

    if (event === 'connection.update' || event === 'connection_update') {
      const instanceName = evtInstance
      const state: string = (body.data?.instance?.state ?? body.data?.state ?? '').toLowerCase()
      const reason = body.data?.statusReason ?? body.data?.instance?.statusReason ?? null
      // Baixo volume e decisivo para diagnóstico: mídia e foto de perfil só
      // funcionam com a instância "open".
      log.info('conexão da instância mudou', { instance: instanceName, state, reason })
      if (state === 'close' && reason === 401) {
        log.error('AUTH-401: sessão recusada pelo WhatsApp — QR nunca gerado; proxy pode estar bloqueando nova sessão', { instance: instanceName })
      }
      if (state === 'open' && instanceName) clearQr(instanceName)
      return NextResponse.json({ ok: true })
    }

    if (event === 'messages.update') {
      const updates: Array<{ key: { id: string; fromMe: boolean }; update: { status: string } }> =
        Array.isArray(body.data) ? body.data : []

      const results = await Promise.all(
        updates
          .filter((u) => u.key?.fromMe === true && u.update?.status)
          .map(async (u) => {
            const status = EVO_STATUS_MAP[String(u.update.status)] ?? null
            if (!status) return null
            const { error } = await supabase
              .from('messages')
              .update({ status })
              .eq('wa_message_id', u.key.id)
            return error ? { msgId: u.key.id, error } : null
          })
      )
      for (const failure of results) {
        if (failure) log.warn('falha ao atualizar status de entrega', { instance: evtInstance, msgId: failure.msgId, err: failure.error }, { throttleKey: `status-update:${failure.error.code}` })
      }
      return NextResponse.json({ ok: true })
    }

    // Quando o WhatsApp sincroniza a lista de chats com a Evolution API, ela envia CHATS_UPSERT.
    // Processamos aqui para criar conversas imediatamente — sem depender do endpoint findChats.
    if (event === 'chats.upsert') {
      const chats = Array.isArray(body.data) ? body.data : []
      const instanceName = evtInstance
      if (instanceName && chats.length > 0) {
        log.debug('chats.upsert', { instance: instanceName, chats: chats.length })
        let failed = 0
        let lastError: unknown = null
        for (const chat of chats) {
          const remoteJid: string = chat.remoteJid ?? ''
          if (!remoteJid || !remoteJid.includes('@')) continue
          // Skip @lid JIDs — Evolution sends them for some contacts but they create duplicate
          // conversations separate from the @s.whatsapp.net entry for the same contact
          if (remoteJid.endsWith('@lid')) continue
          const isGroup = remoteJid.endsWith('@g.us')
          const contactPhone = isGroup
            ? remoteJid
            : remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')
          const contactName: string | null = chat.name ?? chat.pushName ?? null
          const unreadCount: number = chat.unreadCount ?? 0

          const { error } = await supabase.from('conversations').upsert(
            {
              wa_id: remoteJid,
              instance_name: instanceName,
              contact_phone: contactPhone,
              unread_count: unreadCount,
              ...(contactName ? { contact_name: contactName } : {}),
            },
            { onConflict: 'wa_id, instance_name' }
          )
          if (error) {
            failed += 1
            lastError = error
          }
        }
        if (failed > 0) {
          log.warn('chats.upsert: conversas não gravadas', { instance: instanceName, failed, total: chats.length, err: lastError })
        }
      }
      return NextResponse.json({ ok: true })
    }

    if (event !== 'messages.upsert') {
      return NextResponse.json({ ok: true })
    }

    const data = body.data
    if (!data?.key || !data?.message) {
      return NextResponse.json({ ok: true })
    }

    const instanceName = evtInstance
    if (!instanceName) {
      log.error('messages.upsert sem "instance" no payload — evento ignorado')
      return NextResponse.json({ ok: true })
    }

    const waMessageId: string = data.key.id
    const remoteJid: string = data.key.remoteJid
    const direction = data.key.fromMe === true ? 'out' : 'in'

    // Reação, edição, exclusão, chaves de criptografia: não são mensagens do
    // chat. Antes viravam "[mídia]" e ainda trocavam a prévia da conversa.
    const parsed = parseEvolutionMessage(data.message)
    if (parsed.kind === 'ignore') {
      log.debug('mensagem sem conteúdo de chat ignorada', { instance: instanceName, msgId: waMessageId, sourceType: parsed.sourceType })
      return NextResponse.json({ ok: true })
    }
    if (parsed.kind === 'unknown') {
      // Sinal para evoluir o parser: diz exatamente qual formato chegou.
      log.warn('formato de mensagem desconhecido — salvo como [mídia]', {
        instance: instanceName,
        msgId: waMessageId,
        keys: parsed.keys.join(','),
        wrappers: parsed.wrappers.join(',') || undefined,
      }, { throttleKey: `unknown:${parsed.keys.join(',')}` })
    }

    // Dedup: Evolution API pode reenviar o mesmo webhook. O índice único em
    // wa_message_id é a garantia de verdade (corrida entre entregas); esta
    // consulta só evita trabalho (download de mídia) no caso comum.
    const { data: existingMsg, error: dedupError } = await supabase
      .from('messages')
      .select('id')
      .eq('wa_message_id', waMessageId)
      .maybeSingle()

    if (dedupError) {
      log.warn('falha na checagem de duplicidade — seguindo; o índice único protege', { instance: instanceName, msgId: waMessageId, err: dedupError })
    }
    if (existingMsg) {
      log.debug('mensagem duplicada ignorada', { instance: instanceName, msgId: waMessageId })
      return NextResponse.json({ ok: true })
    }

    const isGroup = remoteJid.endsWith('@g.us')

    // @lid is an internal WhatsApp ID that Evolution sometimes uses instead of @s.whatsapp.net.
    // Resolve to the existing @s.whatsapp.net conversation so messages don't split into two rows.
    let effectiveRemoteJid = remoteJid
    // Evolution 2.3.7 manda o número real em key.remoteJidAlt (2.3.0: senderPn)
    // quando o WhatsApp endereça o contato por LID. Quando vem, é a resolução
    // exata — as heurísticas abaixo (por nome/telefone) são só o fallback,
    // e a por nome pode até cair na conversa de outra pessoa com mesmo nome.
    const phoneJidAlt = [data.key.remoteJidAlt, data.key.senderPn]
      .find((value): value is string => typeof value === 'string' && value.endsWith('@s.whatsapp.net'))
    if (!isGroup && remoteJid.endsWith('@lid') && phoneJidAlt) {
      effectiveRemoteJid = phoneJidAlt
      log.debug('@lid resolvido pelo número alternativo', { instance: instanceName, msgId: waMessageId })
    } else if (!isGroup && remoteJid.endsWith('@lid')) {
      if (data.key.fromMe === false) {
        // Inbound: resolve by contact name (pushName comes from the sender)
        const lidPushName: string | null = data.pushName ?? null
        if (lidPushName) {
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('wa_id')
            .eq('instance_name', instanceName)
            .eq('contact_name', lidPushName)
            .not('wa_id', 'like', '%@lid')
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (existingConv?.wa_id) effectiveRemoteJid = existingConv.wa_id
        }
      } else {
        // Outbound: no pushName available — find any non-@lid conversation already open
        // with this instance that has last_message_at set (i.e., a real conversation).
        // This covers the case where the sync already created @s.whatsapp.net and the
        // AI/operator replies back to the same contact identified by @lid.
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('wa_id')
          .eq('instance_name', instanceName)
          .eq('contact_phone', remoteJid.replace('@lid', ''))
          .not('wa_id', 'like', '%@lid')
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (existingConv?.wa_id) effectiveRemoteJid = existingConv.wa_id
      }
      // Conversa nova em @lid é a origem conhecida de conversa duplicada —
      // vale registrar quando a resolução não acha a conversa do número.
      if (effectiveRemoteJid === remoteJid) {
        log.info('@lid sem conversa correspondente — criando conversa @lid', { instance: instanceName, jid: maskJid(remoteJid), direction })
      }
    }

    const contactPhone = isGroup ? remoteJid : effectiveRemoteJid.replace('@s.whatsapp.net', '').replace('@lid', '')

    // For groups: pushName is the SENDER's name, not the group name.
    // Never overwrite the group name with a sender's name — look up the group name from our DB.
    // For contacts: use pushName from payload, fall back to Contact/Chat tables.
    let contactName: string | null = null

    if (isGroup) {
      // Preserve the group name already stored — don't touch it from webhook payload
      const { data: existing } = await supabase
        .from('conversations')
        .select('contact_name')
        .eq('wa_id', remoteJid)
        .eq('instance_name', instanceName)
        .maybeSingle()
      contactName = (existing as { contact_name?: string | null } | null)?.contact_name ?? null

      if (!contactName) {
        // First time seeing this group — look it up from Evolution's Chat table
        const { data: chatRow } = await supabase
          .from('Chat')
          .select('name')
          .eq('remoteJid', remoteJid)
          .maybeSingle()
        contactName = chatRow?.name || null
      }
    } else {
      contactName = data.key.fromMe === false ? (data.pushName || null) : null

      if (!contactName) {
        const { data: contactRow } = await supabase
          .from('Contact')
          .select('pushName')
          .eq('remoteJid', remoteJid)
          .maybeSingle()
        contactName = contactRow?.pushName || null

        if (!contactName) {
          const { data: chatRow } = await supabase
            .from('Chat')
            .select('name')
            .eq('remoteJid', remoteJid)
            .maybeSingle()
          contactName = chatRow?.name || null
        }
      }
    }

    let content: string
    let type: string
    let preview: string
    if (parsed.kind === 'unknown') {
      content = '[mídia]'
      type = 'media'
      preview = '[mídia]'
    } else {
      content = parsed.content
      type = parsed.type
      preview = previewForParsedMessage(parsed)
      if (parsed.type === 'image') {
        // Se webhookBase64=true na Evolution, o base64 já vem no payload
        const mediaUrl = parsed.inlineBase64
          ? await storeBase64Media(parsed.inlineBase64, parsed.mimetype ?? 'image/jpeg', waMessageId)
          : await downloadAndStoreMedia(data, waMessageId, instanceName)
        // A bolha do chat entende "URL\nlegenda" — antes a legenda se perdia
        // sempre que o download dava certo.
        if (mediaUrl) content = parsed.caption ? `${mediaUrl}\n${parsed.caption}` : mediaUrl
      }
    }

    let preloadedFlowRun: Awaited<ReturnType<typeof checkActiveFlowRun>> | null = null
    let preloadedFlowRunIsSandboxFallback = false
    const isInteractiveReply = parsed.kind === 'content' && parsed.sourceType === 'interactiveReply'
    if (isInteractiveReply && data.key.fromMe !== true) {
      preloadedFlowRun = await checkActiveFlowRun(instanceName, effectiveRemoteJid)
      if (!preloadedFlowRun) {
        preloadedFlowRun = await checkActiveSandboxFlowRunForRealInstance(instanceName, effectiveRemoteJid)
        preloadedFlowRunIsSandboxFallback = Boolean(preloadedFlowRun)
      }
      const variables = preloadedFlowRun?.variables && typeof preloadedFlowRun.variables === 'object'
        ? preloadedFlowRun.variables as Record<string, unknown>
        : {}
      const replyButtons = Array.isArray(variables.replyButtons)
        ? variables.replyButtons as FlowReplyButton[]
        : []
      content = normalizeReplyInput(content, replyButtons)
      preview = content
    }

    // 1) Garante a conversa SEM mexer na prévia. A prévia só é atualizada
    //    depois que a mensagem existe — antes, uma falha no insert deixava a
    //    conversa com "[imagem]" na lista e nenhuma mensagem dentro.
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert(
        {
          wa_id: effectiveRemoteJid,
          instance_name: instanceName,
          contact_phone: contactPhone,
          // Só atualiza contact_name se pushName veio preenchido,
          // para não sobrescrever um nome existente com null
          ...(contactName ? { contact_name: contactName } : {}),
        },
        { onConflict: 'wa_id, instance_name' }
      )
      .select()
      .single()

    if (convError || !conversation) {
      log.error('falha ao gravar conversa — evento devolvido com 500', {
        instance: instanceName,
        msgId: waMessageId,
        jid: maskJid(effectiveRemoteJid),
        err: convError,
      })
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    // Eco de uma mensagem que nós mesmos enviamos (operador): a linha
    // pendente ("enviando") já existe — recebe o id em vez de duplicar.
    if (data.key.fromMe === true) {
      const attached = await attachEchoToPendingOutbound({ conversationId: conversation.id, waMessageId, content, type })
      if (attached) return NextResponse.json({ ok: true })
    }

    // 2) Mensagem.
    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      wa_message_id: waMessageId,
      content,
      type,
      direction: data.key.fromMe === true ? 'outbound' : 'inbound',
      status: data.key.fromMe === true ? 'sent' : 'delivered',
      sender_type: data.key.fromMe === true ? 'human' : null,
      sender_jid:  isGroup ? (data.key.participant ?? null) : null,
      sender_name: isGroup ? (data.pushName || null)        : null,
    })
    if (msgError) {
      if (msgError.code === UNIQUE_VIOLATION) {
        // Outra entrega do mesmo evento gravou primeiro (às vezes com o
        // contato endereçado de outro jeito — @lid vs número). Se esta
        // entrega acabou de criar uma conversa só para essa mensagem, ela
        // ficaria vazia na lista: remove.
        await removeConversationIfJustCreatedAndEmpty(conversation, instanceName, waMessageId)
        log.debug('mensagem já gravada por entrega concorrente', { instance: instanceName, msgId: waMessageId })
        return NextResponse.json({ ok: true })
      }
      // 500 para a Evolution poder reenviar; a prévia continua coerente
      // com as mensagens que de fato existem.
      log.error('falha ao gravar mensagem — evento devolvido com 500', {
        instance: instanceName,
        msgId: waMessageId,
        conversationId: conversation.id,
        type,
        err: msgError,
      })
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    // 3) Prévia + não lidas, só agora que a mensagem existe.
    const { error: previewError } = await supabase
      .from('conversations')
      .update({
        last_message: preview,
        last_message_at: new Date().toISOString(),
        unread_count: data.key.fromMe === true
          ? 0
          : (conversation.unread_count ?? 0) + 1,
      })
      .eq('id', conversation.id)
    if (previewError) {
      log.warn('mensagem gravada, mas a prévia da conversa não foi atualizada', { instance: instanceName, conversationId: conversation.id, err: previewError })
    }

    log.info('mensagem gravada', {
      instance: instanceName,
      conversationId: conversation.id,
      msgId: waMessageId,
      direction,
      type,
      ...(parsed.kind === 'content' && parsed.wrappers.length > 0 ? { wrappers: parsed.wrappers.join(',') } : {}),
      ...(type === 'image' && !content.startsWith('http') ? { media: 'pendente' } : {}),
    })

    if (data.key.fromMe !== true && type === 'text') {
      void (async () => {
        try {
          let flowRun = preloadedFlowRun
          let flowRunIsSandboxFallback = preloadedFlowRunIsSandboxFallback
          if (!flowRun) {
            flowRun = await checkActiveFlowRun(instanceName, effectiveRemoteJid)
          }
          if (!flowRun) {
            // Fluxo pausado no Sandbox mas entregue de verdade por esta
            // instância (envio real do Sandbox) — a resposta chegou aqui,
            // não em "__sandbox__". Ver checkActiveSandboxFlowRunForRealInstance.
            flowRun = await checkActiveSandboxFlowRunForRealInstance(instanceName, effectiveRemoteJid)
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
              remoteJid: effectiveRemoteJid,
              conversationId: flowRunIsSandboxFallback ? flowRun.conversation_id : conversation.id,
              incomingMessage: normalizedContent,
              orderId: typeof variables.orderId === 'string' ? variables.orderId : undefined,
              checkoutId: typeof variables.checkoutId === 'string' ? variables.checkoutId : undefined,
              flowRunId: typeof flowRun.id === 'string' ? flowRun.id : undefined,
              isSandbox: flowRunIsSandboxFallback ? true : undefined,
              realSendInstanceName: flowRunIsSandboxFallback ? instanceName : undefined,
            }, flowRun.node_id)
          } else {
            const session = await checkActiveSession(instanceName, effectiveRemoteJid)
            if (session) {
            await handleActiveSession(session, {
              instanceName,
              remoteJid: effectiveRemoteJid,
              conversationId: conversation.id,
              incomingMessage: content,
            })
            } else {
              await executeTriggers(instanceName, effectiveRemoteJid, conversation.id, content, type)
            }
          }
        } catch (err) {
          // Roda depois da resposta HTTP — sem este log, uma falha na
          // automação (fluxo, IA, gatilho) seria invisível.
          log.error('falha na automação após mensagem recebida', {
            instance: instanceName,
            conversationId: conversation.id,
            msgId: waMessageId,
            err,
          })
        }
      })()
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('erro inesperado no webhook', { err })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

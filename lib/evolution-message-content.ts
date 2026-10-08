import { extractInteractiveReplyText } from './evolution-message'

// Interpreta o objeto `message` (formato Baileys) que a Evolution entrega no
// webhook messages.upsert e guarda na tabela "Message". Fonte única usada
// pelo webhook e pelas duas rotas de sincronização — antes cada uma tinha a
// sua cópia, e um tipo novo do WhatsApp virava "[mídia]" sem aviso.

type UnknownRecord = Record<string, unknown>

export type EvolutionContentType = 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'media'
export type EvolutionMediaMessageType = 'imageMessage' | 'videoMessage' | 'audioMessage' | 'stickerMessage'

export type ParsedEvolutionMessage =
  | {
    kind: 'content'
    type: EvolutionContentType
    // Texto para gravar em messages.content (placeholder quando é mídia sem texto)
    content: string
    caption: string | null
    // Chave do objeto de mídia — base para baixar o arquivo na Evolution
    mediaMessageType: EvolutionMediaMessageType | null
    // Base64 inline (só quando a Evolution está com webhook_base64 ligado)
    inlineBase64: string | null
    mimetype: string | null
    // Tipo do WhatsApp que gerou o conteúdo (ex: "imageMessage") e os
    // envelopes abertos no caminho (ex: ["ephemeralMessage"]) — para log.
    sourceType: string
    wrappers: string[]
  }
  | {
    // Não é conteúdo para o chat (reação, edição, exclusão, chaves de
    // criptografia...): não deve virar mensagem nem mexer na prévia.
    kind: 'ignore'
    sourceType: string
    wrappers: string[]
  }
  | {
    // Formato que o parser não conhece — vira "[mídia]" e deve ser logado
    // com as chaves, para sabermos o que o WhatsApp está mandando.
    kind: 'unknown'
    keys: string[]
    wrappers: string[]
  }

// Envelopes que só embrulham outra mensagem em `.message`.
const WRAPPER_KEYS = [
  'ephemeralMessage', // mensagens temporárias
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'associatedChildMessage', // fotos/vídeos de um álbum
  'editedMessage',
  'deviceSentMessage', // enviada pelo próprio número em outro aparelho
  'groupMentionedMessage',
  'botInvokeMessage',
] as const

// Chaves que nunca são conteúdo visível. `messageContextInfo` costuma vir ao
// lado do conteúdo real — sozinha, não é mensagem.
const NON_CONTENT_KEYS = new Set([
  'messageContextInfo',
  'reactionMessage',
  'encReactionMessage',
  'protocolMessage', // exclusão/edição/efêmero — afeta outra mensagem
  'senderKeyDistributionMessage',
  'albumMessage', // cabeçalho do álbum; as fotos chegam em mensagens próprias
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'callLogMesssage',
  'call',
])

const MAX_UNWRAP_DEPTH = 5

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function unwrapEvolutionMessage(message: unknown): { message: UnknownRecord; wrappers: string[] } {
  let current = asRecord(message) ?? {}
  const wrappers: string[] = []
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    const wrapperKey = WRAPPER_KEYS.find((key) => asRecord(asRecord(current[key])?.message))
    if (!wrapperKey) break
    wrappers.push(wrapperKey)
    current = asRecord(asRecord(current[wrapperKey])?.message) ?? {}
  }
  return { message: current, wrappers }
}

function media(
  type: EvolutionContentType,
  mediaMessageType: EvolutionMediaMessageType,
  node: UnknownRecord,
  placeholder: string,
  sourceType: string,
  wrappers: string[]
): ParsedEvolutionMessage {
  // Áudio e figurinha não têm legenda no WhatsApp.
  const caption = type === 'audio' || type === 'sticker' ? null : text(node.caption)
  return {
    kind: 'content',
    type,
    content: caption ?? placeholder,
    caption,
    mediaMessageType,
    inlineBase64: text(node.base64),
    mimetype: text(node.mimetype),
    sourceType,
    wrappers,
  }
}

function plain(
  type: EvolutionContentType,
  content: string,
  sourceType: string,
  wrappers: string[]
): ParsedEvolutionMessage {
  return { kind: 'content', type, content, caption: null, mediaMessageType: null, inlineBase64: null, mimetype: null, sourceType, wrappers }
}

export function parseEvolutionMessage(rawMessage: unknown): ParsedEvolutionMessage {
  const { message, wrappers } = unwrapEvolutionMessage(rawMessage)

  const interactiveReply = extractInteractiveReplyText(message)
  if (interactiveReply) return plain('text', interactiveReply, 'interactiveReply', wrappers)

  const conversation = text(message.conversation)
  if (conversation) return plain('text', conversation, 'conversation', wrappers)
  const extended = text(asRecord(message.extendedTextMessage)?.text)
  if (extended) return plain('text', extended, 'extendedTextMessage', wrappers)

  const image = asRecord(message.imageMessage)
  if (image) return media('image', 'imageMessage', image, '[imagem]', 'imageMessage', wrappers)
  const video = asRecord(message.videoMessage) ?? asRecord(message.ptvMessage)
  if (video) return media('video', 'videoMessage', video, '[vídeo]', message.videoMessage ? 'videoMessage' : 'ptvMessage', wrappers)
  const audio = asRecord(message.audioMessage) ?? asRecord(message.pttMessage)
  if (audio) return media('audio', 'audioMessage', audio, '[áudio]', message.audioMessage ? 'audioMessage' : 'pttMessage', wrappers)
  const sticker = asRecord(message.stickerMessage)
  if (sticker) return media('sticker', 'stickerMessage', sticker, '[figurinha]', 'stickerMessage', wrappers)

  const documentNode = asRecord(message.documentMessage)
  if (documentNode) {
    const name = text(documentNode.fileName) ?? text(documentNode.title)
    const caption = text(documentNode.caption)
    return plain('media', [`📄 ${name ?? 'Documento'}`, caption].filter(Boolean).join('\n'), 'documentMessage', wrappers)
  }
  const location = asRecord(message.locationMessage) ?? asRecord(message.liveLocationMessage)
  if (location) {
    const label = text(location.name) ?? text(location.address)
    return plain('media', `📍 Localização${label ? `: ${label}` : ''}`, 'locationMessage', wrappers)
  }
  const contact = asRecord(message.contactMessage)
  if (contact) return plain('media', `👤 Contato: ${text(contact.displayName) ?? 'sem nome'}`, 'contactMessage', wrappers)
  if (asRecord(message.contactsArrayMessage)) return plain('media', '👥 Contatos compartilhados', 'contactsArrayMessage', wrappers)
  const poll = asRecord(message.pollCreationMessage) ?? asRecord(message.pollCreationMessageV2) ?? asRecord(message.pollCreationMessageV3)
  if (poll) return plain('media', `📊 Enquete: ${text(poll.name) ?? ''}`.trim(), 'pollCreationMessage', wrappers)

  // Mensagens com botões/listas enviadas pelo próprio número (eco de envio).
  const buttonsText = text(asRecord(message.buttonsMessage)?.contentText)
    ?? text(asRecord(asRecord(message.interactiveMessage)?.body)?.text)
    ?? text(asRecord(message.listMessage)?.description)
    ?? text(asRecord(asRecord(message.templateMessage)?.hydratedTemplate)?.hydratedContentText)
  if (buttonsText) return plain('text', buttonsText, 'interactiveMessage', wrappers)

  const keys = Object.keys(message)
  const contentKeys = keys.filter((key) => !NON_CONTENT_KEYS.has(key))
  if (contentKeys.length === 0) {
    return { kind: 'ignore', sourceType: keys.find((key) => key !== 'messageContextInfo') ?? 'empty', wrappers }
  }
  return { kind: 'unknown', keys: contentKeys, wrappers }
}

// Prévia da lista de conversas para um conteúdo (mídia nunca mostra a URL).
export function previewForParsedMessage(parsed: Extract<ParsedEvolutionMessage, { kind: 'content' }>): string {
  if (parsed.type === 'image') return parsed.caption ? `📷 ${parsed.caption}` : '[imagem]'
  if (parsed.type === 'video') return parsed.caption ? `🎥 ${parsed.caption}` : '[vídeo]'
  if (parsed.type === 'audio') return '[áudio]'
  if (parsed.type === 'sticker') return '[figurinha]'
  return parsed.content
}

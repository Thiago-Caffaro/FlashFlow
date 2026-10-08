import { parseEvolutionMessage, previewForParsedMessage } from '@/lib/evolution-message-content'

function content(message: unknown) {
  const parsed = parseEvolutionMessage(message)
  if (parsed.kind !== 'content') throw new Error(`esperava conteúdo, veio ${parsed.kind}`)
  return parsed
}

describe('parseEvolutionMessage', () => {
  it('reads plain and extended text', () => {
    expect(content({ conversation: 'oi' })).toMatchObject({ type: 'text', content: 'oi' })
    expect(content({ extendedTextMessage: { text: 'link https://x' }, messageContextInfo: {} })).toMatchObject({ type: 'text', content: 'link https://x' })
  })

  it('opens WhatsApp envelopes instead of saving "[mídia]" (temporárias, visualização única, álbum, outro aparelho)', () => {
    expect(content({ ephemeralMessage: { message: { extendedTextMessage: { text: 'quero 2 frascos' } } } }))
      .toMatchObject({ type: 'text', content: 'quero 2 frascos', wrappers: ['ephemeralMessage'] })
    expect(content({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } } } }))
      .toMatchObject({ type: 'image', caption: 'foto', mediaMessageType: 'imageMessage' })
    expect(content({ associatedChildMessage: { message: { imageMessage: { mimetype: 'image/png' } } } }))
      .toMatchObject({ type: 'image', content: '[imagem]', wrappers: ['associatedChildMessage'] })
    expect(content({ deviceSentMessage: { destinationJid: 'x', message: { conversation: 'enviada do celular' } } }))
      .toMatchObject({ type: 'text', content: 'enviada do celular' })
  })

  it('finds a button reply even inside an envelope', () => {
    expect(content({ ephemeralMessage: { message: { buttonsResponseMessage: { selectedDisplayText: 'Confirmar' } } } }))
      .toMatchObject({ type: 'text', content: 'Confirmar', sourceType: 'interactiveReply' })
  })

  it('keeps inline base64 and mimetype for images; audio and stickers never carry a caption', () => {
    expect(content({ imageMessage: { base64: 'AAA', mimetype: 'image/png' } })).toMatchObject({ inlineBase64: 'AAA', mimetype: 'image/png' })
    expect(content({ pttMessage: { caption: 'x' } })).toMatchObject({ type: 'audio', content: '[áudio]', caption: null })
    expect(content({ stickerMessage: {} })).toMatchObject({ type: 'sticker', content: '[figurinha]' })
  })

  it('describes documents, locations and contacts instead of "[mídia]"', () => {
    expect(content({ documentMessage: { fileName: 'pedido.pdf' } }).content).toBe('📄 pedido.pdf')
    expect(content({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'nf.pdf', caption: 'segue' } } } }).content).toBe('📄 nf.pdf\nsegue')
    expect(content({ locationMessage: { name: 'Loja Centro' } }).content).toBe('📍 Localização: Loja Centro')
    expect(content({ contactMessage: { displayName: 'Ana' } }).content).toBe('👤 Contato: Ana')
  })

  it('ignores what is not chat content: reactions, edits/deletions, encryption keys', () => {
    expect(parseEvolutionMessage({ reactionMessage: { text: '👍' } })).toMatchObject({ kind: 'ignore', sourceType: 'reactionMessage' })
    expect(parseEvolutionMessage({ protocolMessage: { type: 0 }, messageContextInfo: {} })).toMatchObject({ kind: 'ignore', sourceType: 'protocolMessage' })
    expect(parseEvolutionMessage({ senderKeyDistributionMessage: {} })).toMatchObject({ kind: 'ignore' })
    expect(parseEvolutionMessage({ messageContextInfo: {} })).toMatchObject({ kind: 'ignore' })
  })

  it('reports the keys of a genuinely unknown format', () => {
    expect(parseEvolutionMessage({ newFancyMessage: { a: 1 }, messageContextInfo: {} }))
      .toEqual({ kind: 'unknown', keys: ['newFancyMessage'], wrappers: [] })
  })

  it('builds a conversation preview that never shows a media URL', () => {
    expect(previewForParsedMessage(content({ imageMessage: { caption: 'olha' } }))).toBe('📷 olha')
    expect(previewForParsedMessage(content({ imageMessage: {} }))).toBe('[imagem]')
    expect(previewForParsedMessage(content({ conversation: 'oi' }))).toBe('oi')
  })
})

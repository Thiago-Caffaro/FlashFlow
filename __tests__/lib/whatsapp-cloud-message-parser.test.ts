/**
 * Testes para lib/whatsapp-cloud-message-parser.ts — extração de texto de
 * resposta a botão interativo (Fase 3), fixtures de payload puras, sem mock.
 */
import { extractCloudInteractiveReplyText } from '@/lib/whatsapp-cloud-message-parser'

describe('extractCloudInteractiveReplyText', () => {
  it('extracts the title from an interactive button_reply payload', () => {
    const message = {
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'CONFIRMAR PEDIDO' } },
    }
    expect(extractCloudInteractiveReplyText(message)).toBe('CONFIRMAR PEDIDO')
  })

  it('falls back to the id when title is missing', () => {
    const message = {
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'confirm' } },
    }
    expect(extractCloudInteractiveReplyText(message)).toBe('confirm')
  })

  it('extracts text from the legacy button payload', () => {
    const message = { type: 'button', button: { text: 'CONFIRMAR', payload: 'confirm' } }
    expect(extractCloudInteractiveReplyText(message)).toBe('CONFIRMAR')
  })

  it('falls back to payload when legacy button text is missing', () => {
    const message = { type: 'button', button: { payload: 'confirm' } }
    expect(extractCloudInteractiveReplyText(message)).toBe('confirm')
  })

  it('returns null for a plain text message', () => {
    const message = { type: 'text', text: { body: 'oi' } }
    expect(extractCloudInteractiveReplyText(message)).toBeNull()
  })

  it('returns null for malformed/empty interactive payload', () => {
    expect(extractCloudInteractiveReplyText({ type: 'interactive' })).toBeNull()
    expect(extractCloudInteractiveReplyText({ type: 'interactive', interactive: {} })).toBeNull()
    expect(extractCloudInteractiveReplyText(null)).toBeNull()
    expect(extractCloudInteractiveReplyText(undefined)).toBeNull()
  })
})

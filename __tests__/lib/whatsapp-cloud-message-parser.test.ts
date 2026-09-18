/**
 * Testes para lib/whatsapp-cloud-message-parser.ts — extração de texto de
 * resposta a botão interativo (Fase 3), fixtures de payload puras, sem mock.
 */
import { extractCloudInteractiveReplyText, extractCloudReplyPayload } from '@/lib/whatsapp-cloud-message-parser'

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

describe('extractCloudReplyPayload', () => {
  it('returns the id we set on an interactive reply button, not the (possibly truncated) title', () => {
    const message = {
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'btn-yes', title: 'CONFIRMAR PEDIDO CO…' } },
    }
    expect(extractCloudReplyPayload(message)).toBe('btn-yes')
  })

  it('returns the payload we set on a template quick-reply button', () => {
    const message = { type: 'button', button: { text: 'Sí, confirmo', payload: 'btn-yes' } }
    expect(extractCloudReplyPayload(message)).toBe('btn-yes')
  })

  it('returns null when there is no payload, for plain text, and for malformed input', () => {
    expect(extractCloudReplyPayload({ type: 'button', button: { text: 'Sí' } })).toBeNull()
    expect(extractCloudReplyPayload({ type: 'text', text: { body: 'oi' } })).toBeNull()
    expect(extractCloudReplyPayload({ type: 'interactive' })).toBeNull()
    expect(extractCloudReplyPayload(null)).toBeNull()
  })
})

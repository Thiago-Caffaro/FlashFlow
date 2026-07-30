import { extractInteractiveReplyText } from '@/lib/evolution-message'

describe('extractInteractiveReplyText', () => {
  it('extracts a Baileys button display label', () => {
    expect(extractInteractiveReplyText({
      buttonsResponseMessage: {
        selectedButtonId: 'confirm',
        selectedDisplayText: 'CONFIRMAR PEDIDO',
      },
    })).toBe('CONFIRMAR PEDIDO')
  })

  it('extracts native-flow button replies from paramsJson', () => {
    expect(extractInteractiveReplyText({
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({
            button_reply: { id: 'change', display_text: 'MODIFICAR DADOS' },
          }),
        },
      },
    })).toBe('MODIFICAR DADOS')
  })

  it('returns null for ordinary text messages', () => {
    expect(extractInteractiveReplyText({ conversation: 'oi' })).toBeNull()
  })
})

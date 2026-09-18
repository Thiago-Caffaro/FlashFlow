import { getTemplateQuickReplyButtons } from '@/lib/whatsapp-template-buttons'

describe('getTemplateQuickReplyButtons', () => {
  it('returns only quick replies, keeping the index from the full button list', () => {
    const buttons = [
      { type: 'QUICK_REPLY', text: 'Sim' },
      { type: 'URL', text: 'Ver pedido', url: 'https://example.com' },
      { type: 'quick_reply', text: 'Não' },
      { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511999999999' },
    ]
    expect(getTemplateQuickReplyButtons(buttons)).toEqual([
      { index: 0, text: 'Sim' },
      { index: 2, text: 'Não' },
    ])
  })

  it('returns an empty list for templates without buttons or with malformed data', () => {
    expect(getTemplateQuickReplyButtons([])).toEqual([])
    expect(getTemplateQuickReplyButtons(null)).toEqual([])
    expect(getTemplateQuickReplyButtons({})).toEqual([])
    expect(getTemplateQuickReplyButtons([null, 'x', { text: 'sem tipo' }])).toEqual([])
  })
})

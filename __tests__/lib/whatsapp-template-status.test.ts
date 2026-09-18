import { templateStatusLabel } from '@/lib/whatsapp-template-status'

describe('templateStatusLabel', () => {
  it('labels each status in Portuguese', () => {
    expect(templateStatusLabel('approved')).toBe('aprovado')
    expect(templateStatusLabel('pending')).toBe('em análise')
    expect(templateStatusLabel('paused')).toBe('pausado')
    expect(templateStatusLabel('disabled')).toBe('desativado')
  })

  it('appends a readable rejection reason, falling back to the raw value for unknown reasons', () => {
    expect(templateStatusLabel('rejected', 'INCORRECT_CATEGORY')).toBe('rejeitado: categoria incorreta')
    expect(templateStatusLabel('rejected', 'NEW_REASON_FROM_META')).toBe('rejeitado: NEW_REASON_FROM_META')
    expect(templateStatusLabel('rejected', '  ')).toBe('rejeitado')
    expect(templateStatusLabel('rejected', null)).toBe('rejeitado')
  })
})

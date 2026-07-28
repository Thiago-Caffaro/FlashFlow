import { redactContent, redactPhone } from '@/lib/redact'

describe('redactPhone', () => {
  it('mantém só os últimos 4 dígitos', () => {
    expect(redactPhone('5521999998888')).toBe('*********8888')
  })

  it('remove caracteres não numéricos antes de mascarar', () => {
    expect(redactPhone('+55 (21) 99999-8888')).toBe('*********8888')
  })

  it('mascara totalmente números com 4 dígitos ou menos', () => {
    expect(redactPhone('123')).toBe('***')
  })
})

describe('redactContent', () => {
  it('mantém texto curto inalterado', () => {
    expect(redactContent('oi tudo bem?')).toBe('oi tudo bem?')
  })

  it('trunca texto longo e adiciona reticências', () => {
    const long = 'x'.repeat(100)
    const result = redactContent(long, 40)
    expect(result.length).toBe(41)
    expect(result.endsWith('…')).toBe(true)
  })
})

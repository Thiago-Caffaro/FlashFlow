import { _resetRateLimitForTests, checkRateLimit, getClientIp } from '@/lib/rate-limit'

beforeEach(() => _resetRateLimitForTests())

describe('checkRateLimit', () => {
  it('permite até o limite e bloqueia depois disso, dentro da janela', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('k1', 5, 60000)).toBe(true)
    }
    expect(checkRateLimit('k1', 5, 60000)).toBe(false)
  })

  it('chaves diferentes têm contadores independentes', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k1', 5, 60000)
    expect(checkRateLimit('k2', 5, 60000)).toBe(true)
  })
})

describe('getClientIp', () => {
  it('lê x-forwarded-for, x-real-ip ou retorna unknown', () => {
    expect(getClientIp({ headers: { get: (n) => (n === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null) } })).toBe('1.2.3.4')
    expect(getClientIp({ headers: { get: (n) => (n === 'x-real-ip' ? '9.9.9.9' : null) } })).toBe('9.9.9.9')
    expect(getClientIp({ headers: { get: () => null } })).toBe('unknown')
  })
})

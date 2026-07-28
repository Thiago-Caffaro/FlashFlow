import { _resetLoginRateLimitForTests, checkLoginRateLimit, getClientIp } from '@/lib/login-rate-limit'

beforeEach(() => {
  _resetLoginRateLimitForTests()
})

describe('checkLoginRateLimit', () => {
  it('permite as primeiras 5 tentativas do mesmo IP+usuário', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit('1.2.3.4', 'admin')).toBe(true)
    }
  })

  it('bloqueia a 6a tentativa do mesmo IP+usuário dentro da janela', () => {
    for (let i = 0; i < 5; i++) checkLoginRateLimit('1.2.3.4', 'admin')
    expect(checkLoginRateLimit('1.2.3.4', 'admin')).toBe(false)
  })

  it('usuários diferentes no mesmo IP têm contadores próprios (até o limite de IP)', () => {
    for (let i = 0; i < 5; i++) checkLoginRateLimit('1.2.3.4', 'admin')
    expect(checkLoginRateLimit('1.2.3.4', 'outro-usuario')).toBe(true)
  })

  it('bloqueia pelo limite de IP mesmo variando o usuário a cada tentativa', () => {
    for (let i = 0; i < 20; i++) checkLoginRateLimit('9.9.9.9', `user-${i}`)
    expect(checkLoginRateLimit('9.9.9.9', 'mais-um-usuario')).toBe(false)
  })

  it('IPs diferentes não compartilham limite', () => {
    for (let i = 0; i < 5; i++) checkLoginRateLimit('1.1.1.1', 'admin')
    expect(checkLoginRateLimit('2.2.2.2', 'admin')).toBe(true)
  })
})

describe('getClientIp', () => {
  it('lê o primeiro IP de x-forwarded-for', () => {
    const req = { headers: { get: (n: string) => (n === 'x-forwarded-for' ? '5.6.7.8, 10.0.0.1' : null) } }
    expect(getClientIp(req)).toBe('5.6.7.8')
  })

  it('usa x-real-ip como fallback', () => {
    const req = { headers: { get: (n: string) => (n === 'x-real-ip' ? '5.6.7.8' : null) } }
    expect(getClientIp(req)).toBe('5.6.7.8')
  })

  it('retorna "unknown" sem headers de IP', () => {
    const req = { headers: { get: () => null } }
    expect(getClientIp(req)).toBe('unknown')
  })
})

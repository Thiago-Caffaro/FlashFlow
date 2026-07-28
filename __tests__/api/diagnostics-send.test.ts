import { NextRequest } from 'next/server'
import { _resetRateLimitForTests } from '@/lib/rate-limit'

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/diagnostics/send/route')

function req(body: unknown, ip = '1.2.3.4') {
  return new NextRequest('http://localhost/api/diagnostics/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  _resetRateLimitForTests()
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ key: { id: 'evo-1' } }),
  })
})

describe('POST /api/diagnostics/send', () => {
  it('envia normalmente dentro do limite', async () => {
    const res = await POST(req({ instance: 'inst-a', number: '5521999998888', message: 'teste' }))
    expect(res.status).toBe(200)
  })

  it('bloqueia com 429 após exceder o limite de tentativas do mesmo IP', async () => {
    for (let i = 0; i < 10; i++) {
      await POST(req({ instance: 'inst-a', number: '5521999998888', message: 'teste' }, '9.9.9.9'))
    }
    const res = await POST(req({ instance: 'inst-a', number: '5521999998888', message: 'teste' }, '9.9.9.9'))
    expect(res.status).toBe(429)
  })

  it('não vaza o número de telefone completo nos logs', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    await POST(req({ instance: 'inst-a', number: '5521999998888', message: 'teste' }, '8.8.8.8'))

    const loggedFullNumber = logSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('5521999998888'))
    )
    expect(loggedFullNumber).toBe(false)
    logSpy.mockRestore()
  })
})

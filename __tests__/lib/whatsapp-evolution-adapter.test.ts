/**
 * Testes para o "digitando…" de lib/whatsapp-evolution-adapter.ts — a rota
 * /chat/sendPresence da Evolution é síncrona: envia a presença, segura a
 * requisição pelo `delay` e só então manda "paused".
 */
export {}

const mockFetchEvolution = jest.fn()
jest.mock('@/lib/evolution-api', () => ({
  fetchEvolution: (...args: unknown[]) => mockFetchEvolution(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evolutionAdapter } = require('@/lib/whatsapp-evolution-adapter')

describe('evolutionAdapter typing indicator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts a composing presence to /chat/sendPresence for the instance, with a timeout longer than the delay', async () => {
    mockFetchEvolution.mockResolvedValue({ ok: true, status: 201, body: { presence: 'composing' }, text: '' })

    await evolutionAdapter.sendTypingIndicator('wa 1', '5511999999999@s.whatsapp.net')

    expect(mockFetchEvolution).toHaveBeenCalledTimes(1)
    const [path, init, timeoutMs] = mockFetchEvolution.mock.calls[0]
    expect(path).toBe('/chat/sendPresence/wa%201')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ number: '5511999999999@s.whatsapp.net', presence: 'composing', delay: expect.any(Number) })
    expect(body.delay).toBeGreaterThan(0)
    expect(body.delay).toBeLessThanOrEqual(20_000)
    expect(timeoutMs).toBeGreaterThan(body.delay)
  })

  it('throws on a non-ok response so the caller can log it', async () => {
    mockFetchEvolution.mockResolvedValue({ ok: false, status: 400, body: null, text: 'Bad Request' })

    await expect(evolutionAdapter.sendTypingIndicator('wa-1', 'jid')).rejects.toThrow('400')
  })

  it('posts a paused presence to clear the indicator', async () => {
    mockFetchEvolution.mockResolvedValue({ ok: true, status: 201, body: { presence: 'paused' }, text: '' })

    await evolutionAdapter.clearTypingIndicator('wa-1', '5511999999999@s.whatsapp.net')

    const [path, init] = mockFetchEvolution.mock.calls[0]
    expect(path).toBe('/chat/sendPresence/wa-1')
    expect(JSON.parse(init.body)).toEqual({ number: '5511999999999@s.whatsapp.net', presence: 'paused', delay: 0 })
  })
})

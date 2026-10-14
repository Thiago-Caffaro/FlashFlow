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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _resetTypingLoopsForTests } = require('@/lib/whatsapp-evolution-adapter')

const okPresence = { ok: true, status: 201, body: {}, text: '' }

// Cada ciclo de "composing" fica pendente até o teste liberar — como a
// Evolution, que segura a requisição pelo `delay`.
function controlledCycles() {
  const releases: Array<() => void> = []
  mockFetchEvolution.mockImplementation((_path: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    if (body.presence === 'paused') return Promise.resolve(okPresence)
    return new Promise((resolve) => releases.push(() => resolve(okPresence)))
  })
  return {
    finishCycle: async () => {
      releases.shift()?.()
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

function presences() {
  return mockFetchEvolution.mock.calls.map(([, init]) => JSON.parse(init.body).presence)
}

describe('evolutionAdapter typing indicator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetTypingLoopsForTests()
  })

  it('posts short composing cycles to /chat/sendPresence, with a timeout longer than the delay', async () => {
    const cycles = controlledCycles()
    const running = evolutionAdapter.sendTypingIndicator('wa 1', '5511999999999@s.whatsapp.net')
    await new Promise((resolve) => setImmediate(resolve))

    const [path, init, timeoutMs] = mockFetchEvolution.mock.calls[0]
    expect(path).toBe('/chat/sendPresence/wa%201')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ number: '5511999999999@s.whatsapp.net', presence: 'composing', delay: expect.any(Number) })
    expect(body.delay).toBeGreaterThan(0)
    expect(body.delay).toBeLessThanOrEqual(5_000)
    expect(timeoutMs).toBeGreaterThan(body.delay)

    await evolutionAdapter.clearTypingIndicator('wa 1', '5511999999999@s.whatsapp.net', { replied: true })
    await cycles.finishCycle()
    await running
    expect(presences()).toEqual(['composing'])
  })

  it('throws on a non-ok response so the caller can log it', async () => {
    mockFetchEvolution.mockResolvedValue({ ok: false, status: 400, body: null, text: 'Bad Request' })

    await expect(evolutionAdapter.sendTypingIndicator('wa-1', 'jid')).rejects.toThrow('400')
  })

  it('posts a paused presence right away when no reply is going out', async () => {
    mockFetchEvolution.mockResolvedValue({ ok: true, status: 201, body: { presence: 'paused' }, text: '' })

    await evolutionAdapter.clearTypingIndicator('wa-1', '5511999999999@s.whatsapp.net')

    const [path, init] = mockFetchEvolution.mock.calls[0]
    expect(path).toBe('/chat/sendPresence/wa-1')
    expect(JSON.parse(init.body)).toEqual({ number: '5511999999999@s.whatsapp.net', presence: 'paused', delay: 0 })
  })

  it('a new AI reply in the same chat extends the running loop instead of being cut by the old cycle', async () => {
    const cycles = controlledCycles()
    const first = evolutionAdapter.sendTypingIndicator('wa-1', 'jid')
    await new Promise((resolve) => setImmediate(resolve))

    // Primeira resposta saiu; o cliente manda outra mensagem e a IA começa de novo
    // enquanto o ciclo antigo ainda está aberto na Evolution.
    await evolutionAdapter.clearTypingIndicator('wa-1', 'jid', { replied: true })
    const second = evolutionAdapter.sendTypingIndicator('wa-1', 'jid')
    await second

    await cycles.finishCycle()
    // O laço continua e renova o "digitando…" da segunda resposta.
    expect(presences()).toEqual(['composing', 'composing'])

    await evolutionAdapter.clearTypingIndicator('wa-1', 'jid', { replied: true })
    await cycles.finishCycle()
    await first
    expect(presences()).toEqual(['composing', 'composing'])
  })

  it('keeps typing while another reply in the same chat is still being prepared', async () => {
    const cycles = controlledCycles()
    const first = evolutionAdapter.sendTypingIndicator('wa-1', 'jid')
    await evolutionAdapter.sendTypingIndicator('wa-1', 'jid')

    // Uma das duas respostas falhou: o "digitando…" da outra não é apagado.
    await evolutionAdapter.clearTypingIndicator('wa-1', 'jid')
    expect(presences()).toEqual(['composing'])

    await evolutionAdapter.clearTypingIndicator('wa-1', 'jid')
    expect(presences()).toEqual(['composing', 'paused'])
    await cycles.finishCycle()
    await first
  })
})

/**
 * Testes unitários para app/api/messages/route.ts
 *
 * Estratégia de mock:
 * - @supabase/supabase-js é mockado via jest.mock.
 * - fetch global é substituído por jest.fn() antes de cada teste para
 *   simular chamadas à Evolution API sem rede real.
 */

import { NextRequest } from 'next/server'

// ─── Mock do Supabase ──────────────────────────────────────────────────────────

const supabaseMock = {
  from: jest.fn(),
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// ─── Mock global do fetch ─────────────────────────────────────────────────────

const fetchMock = jest.fn()
global.fetch = fetchMock

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Resposta de sucesso da Evolution API */
function mockEvolutionSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ key: { id: 'evo-msg-id' } }),
    text: jest.fn().mockResolvedValue(''),
  })
}

/** Resposta de falha da Evolution API */
function mockEvolutionFailure() {
  fetchMock.mockResolvedValue({
    ok: false,
    text: jest.fn().mockResolvedValue('Bad Request'),
  })
}

/**
 * Configura supabaseMock para insert em messages + update em conversations,
 * ambos com sucesso.
 */
function mockSupabaseSuccess(savedMessage = { id: 'msg-saved', content: 'oi' }) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'messages') {
      return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: savedMessage, error: null }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
  })
}

// ─── Import da rota (após os mocks) ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/messages/route')

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.EVOLUTION_API_URL = 'http://localhost:8080'
    process.env.EVOLUTION_API_KEY = 'test-key'
  })

  // ── Validação de campos obrigatórios ──────────────────────────────────────

  it('retorna 400 se conversationId estiver ausente', async () => {
    const req = buildRequest({ waId: '5521999887766@s.whatsapp.net', content: 'oi' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.any(String) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retorna 400 se waId estiver ausente', async () => {
    const req = buildRequest({ conversationId: 'conv-1', content: 'oi' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retorna 400 se content estiver ausente', async () => {
    const req = buildRequest({ conversationId: 'conv-1', waId: '5521999887766@s.whatsapp.net' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── Chamada à Evolution API ───────────────────────────────────────────────

  it('chama a Evolution API com number e text corretos', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521912345678@s.whatsapp.net',
      content: 'olá mundo',
    })

    await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/message/sendText/flashflow-main')
    expect(options.method).toBe('POST')

    const sentBody = JSON.parse(options.body)
    expect(sentBody.number).toBe('5521912345678@s.whatsapp.net')
    expect(sentBody.text).toBe('olá mundo')
  })

  it('envia o apikey correto no header da Evolution API', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521912345678@s.whatsapp.net',
      content: 'teste header',
    })

    await POST(req)

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.apikey).toBe('test-key')
  })

  // ── Persistência no Supabase ──────────────────────────────────────────────

  it('salva mensagem no Supabase com direction "outbound"', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521912345678@s.whatsapp.net',
      content: 'mensagem outbound',
    })

    await POST(req)

    const insertCall = supabaseMock.from.mock.results[0].value.insert
    const insertArg = insertCall.mock.calls[0][0]

    expect(insertArg.direction).toBe('outbound')
    expect(insertArg.status).toBe('sent')
    expect(insertArg.content).toBe('mensagem outbound')
    expect(insertArg.conversation_id).toBe('conv-1')
    expect(insertArg.type).toBe('text')
  })

  it('atualiza last_message na conversa após envio', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({
      conversationId: 'conv-42',
      waId: '5521912345678@s.whatsapp.net',
      content: 'atualiza conversa',
    })

    await POST(req)

    const updateCall = supabaseMock.from.mock.results[1].value.update
    const updateArg = updateCall.mock.calls[0][0]

    expect(updateArg.last_message).toBe('atualiza conversa')
    expect(updateArg.last_message_at).toBeDefined()

    const eqCall = updateCall.mock.results[0].value.eq
    expect(eqCall.mock.calls[0]).toEqual(['id', 'conv-42'])
  })

  // ── Resposta de sucesso ───────────────────────────────────────────────────

  it('retorna { ok: true } com a mensagem salva em caso de sucesso', async () => {
    const savedMessage = { id: 'msg-999', content: 'resposta', direction: 'outbound' }
    mockEvolutionSuccess()
    mockSupabaseSuccess(savedMessage)

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521912345678@s.whatsapp.net',
      content: 'resposta',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message).toMatchObject(savedMessage)
  })

  // ── Falha da Evolution API ────────────────────────────────────────────────

  it('retorna 500 se a Evolution API retornar erro', async () => {
    mockEvolutionFailure()

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521912345678@s.whatsapp.net',
      content: 'vai falhar',
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: expect.any(String) })
    // Não deve tentar salvar no Supabase se a Evolution falhou
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})

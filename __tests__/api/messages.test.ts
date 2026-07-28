/**
 * Testes unitários para app/api/messages/route.ts
 *
 * Cobre o achado P7 da varredura de segurança: o destino do envio (wa_id e
 * instance_name) é derivado exclusivamente da conversa carregada no
 * servidor — nunca de um "waId" enviado pelo cliente — e não há mais
 * fallback para a instância "flashflow-main" quando a conversa não é
 * encontrada.
 *
 * Estratégia de mock:
 * - @supabase/supabase-js é mockado via jest.mock.
 * - fetch global é substituído por jest.fn() antes de cada teste para
 *   simular chamadas à Evolution API (via lib/whatsapp-text.ts) sem rede real.
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

function mockEvolutionSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ key: { id: 'evo-msg-id' } }),
    text: jest.fn().mockResolvedValue(JSON.stringify({ key: { id: 'evo-msg-id' } })),
  })
}

function mockEvolutionFailure() {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: jest.fn().mockResolvedValue({ error: 'Bad Request' }),
    text: jest.fn().mockResolvedValue('Bad Request'),
  })
}

function mockEvolutionTimeout() {
  const abortError = new Error('The operation was aborted')
  abortError.name = 'AbortError'
  fetchMock.mockRejectedValue(abortError)
}

/**
 * Configura o Supabase para o caminho feliz completo:
 *   conversations(select) → messages(insert "sending") → messages(update "sent") → conversations(update last_message)
 */
function mockSupabaseSuccess(opts: {
  waId?: string
  instanceName?: string
  updatedMessage?: Record<string, unknown>
} = {}) {
  const waId = opts.waId ?? '5521912345678@s.whatsapp.net'
  const instanceName = opts.instanceName ?? 'flashflow-main'
  const pending = { id: 'pending-1', status: 'sending', content: 'x' }
  const updatedMessage = opts.updatedMessage ?? { ...pending, wa_message_id: 'evo-msg-id', status: 'sent' }

  let messagesCallCount = 0
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'conv-1', wa_id: waId, instance_name: instanceName },
              error: null,
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
    if (table === 'messages') {
      messagesCallCount++
      if (messagesCallCount === 1) {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: pending, error: null }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: updatedMessage, error: null }),
            }),
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }
    }
  })
}

/** Conversa não encontrada — a rota deve falhar ANTES de qualquer envio. */
function mockConversationNotFound() {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
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
    const req = buildRequest({ content: 'oi' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retorna 400 se content estiver ausente', async () => {
    const req = buildRequest({ conversationId: 'conv-1' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── Isolamento: destino vem do servidor, nunca do cliente ────────────────

  it('retorna 404 e não envia nada quando a conversa não existe (sem fallback para flashflow-main)', async () => {
    mockConversationNotFound()

    const req = buildRequest({ conversationId: 'conv-inexistente', content: 'oi' })
    const res = await POST(req)

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    const calledTables = supabaseMock.from.mock.calls.map((c: string[]) => c[0])
    expect(calledTables).not.toContain('messages')
  })

  it('ignora um waId adulterado no corpo e usa o wa_id real da conversa', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess({ waId: '5521900000000@s.whatsapp.net' })

    const req = buildRequest({
      conversationId: 'conv-1',
      waId: '5521999999999@s.whatsapp.net', // número de outro contato — deve ser ignorado
      content: 'olá',
    })

    await POST(req)

    const [, options] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody.number).toBe('5521900000000@s.whatsapp.net')
    expect(sentBody.number).not.toBe('5521999999999@s.whatsapp.net')
  })

  // ── Chamada à Evolution API ───────────────────────────────────────────────

  it('chama a Evolution API com number (da conversa) e text corretos', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess({ waId: '5521912345678@s.whatsapp.net', instanceName: 'flashflow-main' })

    const req = buildRequest({ conversationId: 'conv-1', content: 'olá mundo' })
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

    const req = buildRequest({ conversationId: 'conv-1', content: 'teste header' })
    await POST(req)

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.apikey).toBe('test-key')
  })

  // ── Persistência no Supabase ──────────────────────────────────────────────

  it('registra a mensagem como "sending" antes de enviar e como "sent" com wa_message_id depois', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({ conversationId: 'conv-1', content: 'mensagem outbound' })
    await POST(req)

    // from() calls: 0=conversations(select), 1=messages(insert pending), 2=messages(update sent), 3=conversations(update)
    const insertCall = supabaseMock.from.mock.results[1].value.insert
    const insertArg = insertCall.mock.calls[0][0]
    expect(insertArg.status).toBe('sending')
    expect(insertArg.direction).toBe('outbound')
    expect(insertArg.wa_message_id).toBeNull()

    const updateCall = supabaseMock.from.mock.results[2].value.update
    const updateArg = updateCall.mock.calls[0][0]
    expect(updateArg.status).toBe('sent')
    expect(updateArg.wa_message_id).toBe('evo-msg-id')
  })

  it('atualiza last_message na conversa após envio', async () => {
    mockEvolutionSuccess()
    mockSupabaseSuccess()

    const req = buildRequest({ conversationId: 'conv-1', content: 'atualiza conversa' })
    await POST(req)

    const updateCall = supabaseMock.from.mock.results[3].value.update
    const updateArg = updateCall.mock.calls[0][0]
    expect(updateArg.last_message).toBe('atualiza conversa')
    expect(updateArg.last_message_at).toBeDefined()
  })

  // ── Resposta de sucesso ───────────────────────────────────────────────────

  it('retorna { ok: true } com a mensagem salva em caso de sucesso', async () => {
    const updatedMessage = { id: 'msg-999', content: 'resposta', direction: 'outbound', status: 'sent' }
    mockEvolutionSuccess()
    mockSupabaseSuccess({ updatedMessage })

    const req = buildRequest({ conversationId: 'conv-1', content: 'resposta' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message).toMatchObject(updatedMessage)
  })

  // ── Falha e timeout da Evolution API ──────────────────────────────────────

  it('retorna 502 e marca a mensagem como "failed" quando a Evolution rejeita', async () => {
    mockSupabaseSuccess()
    mockEvolutionFailure()

    const req = buildRequest({ conversationId: 'conv-1', content: 'vai falhar' })
    const res = await POST(req)

    expect(res.status).toBe(502)
    // from() calls: 0=conversations(select), 1=messages(insert pending), 2=messages(update failed)
    const failUpdateCall = supabaseMock.from.mock.results[2].value.update
    expect(failUpdateCall).toHaveBeenCalledWith({ status: 'failed' })
  })

  it('retorna 504 e mantém status "sending" (resultado desconhecido) em timeout, sem marcar como failed', async () => {
    mockSupabaseSuccess()
    mockEvolutionTimeout()

    const req = buildRequest({ conversationId: 'conv-1', content: 'vai expirar' })
    const res = await POST(req)

    expect(res.status).toBe(504)
    // Nenhuma atualização de status deve ocorrer — só o insert "sending" inicial.
    const messagesCalls = supabaseMock.from.mock.calls.filter((c: string[]) => c[0] === 'messages')
    expect(messagesCalls.length).toBe(1)
  })
})

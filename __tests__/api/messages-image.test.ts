/**
 * Testes unitários para app/api/messages/image/route.ts (P7 da varredura de
 * segurança) — mesmo raciocínio de app/api/messages/route.ts: o destino do
 * envio vem exclusivamente da conversa carregada no servidor.
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const uploadFileToStorageMock = jest.fn()
jest.mock('@/lib/storage', () => ({
  uploadFileToStorage: (...args: unknown[]) => uploadFileToStorageMock(...args),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/messages/image/route')

function buildRequest(fields: Record<string, string | Blob>): NextRequest {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value)
  }
  return new NextRequest('http://localhost/api/messages/image', {
    method: 'POST',
    body: formData,
  })
}

function fakeFile(): File {
  // Magic bytes reais de JPEG (FF D8 FF) — necessário porque a rota agora
  // valida o formato pelo conteúdo real, não pelo Content-Type/nome do arquivo.
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
  return new File([jpegBytes], 'foto.jpg', { type: 'image/jpeg' })
}

function fakeNonImageFile(): File {
  return new File(['not-an-image-at-all'], 'evil.svg', { type: 'image/svg+xml' })
}

function mockEvolutionSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ key: { id: 'evo-img-id' } }),
    text: jest.fn().mockResolvedValue(''),
  })
}

function mockEvolutionTimeout() {
  const abortError = new Error('aborted')
  abortError.name = 'AbortError'
  fetchMock.mockRejectedValue(abortError)
}

function mockSupabaseSuccess(opts: { waId?: string; instanceName?: string } = {}) {
  const waId = opts.waId ?? '5521912345678@s.whatsapp.net'
  const instanceName = opts.instanceName ?? 'flashflow-main'
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
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    if (table === 'messages') {
      messagesCallCount++
      if (messagesCallCount === 1) {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'pending-img-1', status: 'sending' }, error: null }),
            }),
          }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'pending-img-1', wa_message_id: 'evo-img-id', status: 'sent' },
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'ai_sessions') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      }
    }
  })
}

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

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
  uploadFileToStorageMock.mockResolvedValue({ path: 'x.jpg', url: 'https://storage.example.com/x.jpg' })
})

describe('POST /api/messages/image', () => {
  it('retorna 400 sem file ou conversationId', async () => {
    const res = await POST(buildRequest({ conversationId: 'conv-1' }))
    expect(res.status).toBe(400)
    expect(uploadFileToStorageMock).not.toHaveBeenCalled()
  })

  it('retorna 404 e não sobe o arquivo quando a conversa não existe (sem fallback flashflow-main)', async () => {
    mockConversationNotFound()
    const res = await POST(buildRequest({ file: fakeFile(), conversationId: 'conv-x' }))
    expect(res.status).toBe(404)
    expect(uploadFileToStorageMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejeita arquivo cujo conteúdo real não é uma imagem, mesmo com Content-Type/nome de imagem', async () => {
    mockSupabaseSuccess()
    const res = await POST(buildRequest({ file: fakeNonImageFile(), conversationId: 'conv-1' }))
    expect(res.status).toBe(400)
    expect(uploadFileToStorageMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignora um waId adulterado no corpo e usa o wa_id real da conversa', async () => {
    mockSupabaseSuccess({ waId: '5521900000000@s.whatsapp.net' })
    mockEvolutionSuccess()

    await POST(buildRequest({
      file: fakeFile(),
      conversationId: 'conv-1',
      waId: '5521999999999@s.whatsapp.net',
    }))

    const [, options] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody.number).toBe('5521900000000@s.whatsapp.net')
  })

  it('envia para a instância correta e salva a mensagem como sent com wa_message_id', async () => {
    mockSupabaseSuccess({ instanceName: 'inst-a' })
    mockEvolutionSuccess()

    const res = await POST(buildRequest({ file: fakeFile(), conversationId: 'conv-1' }))
    expect(res.status).toBe(200)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/message/sendMedia/inst-a')

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message.status).toBe('sent')
    expect(json.message.wa_message_id).toBe('evo-img-id')
  })

  it('retorna 502 e marca como failed quando a Evolution rejeita', async () => {
    mockSupabaseSuccess()
    fetchMock.mockResolvedValue({ ok: false, text: jest.fn().mockResolvedValue('erro') })

    const res = await POST(buildRequest({ file: fakeFile(), conversationId: 'conv-1' }))
    expect(res.status).toBe(502)

    const failUpdateCall = supabaseMock.from.mock.results[2].value.update
    expect(failUpdateCall).toHaveBeenCalledWith({ status: 'failed' })
  })

  it('retorna 504 e mantém "sending" (resultado desconhecido) em timeout', async () => {
    mockSupabaseSuccess()
    mockEvolutionTimeout()

    const res = await POST(buildRequest({ file: fakeFile(), conversationId: 'conv-1' }))
    expect(res.status).toBe(504)

    const messagesCalls = supabaseMock.from.mock.calls.filter((c: string[]) => c[0] === 'messages')
    expect(messagesCalls.length).toBe(1)
  })
})

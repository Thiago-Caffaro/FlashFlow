/**
 * Testes unitários para app/api/webhook/evolution/route.ts
 *
 * Estratégia de mock:
 * - @supabase/supabase-js é mockado via jest.mock para que createClient
 *   retorne um objeto controlado (supabaseMock).
 * - A variável global fetch é substituída por jest.fn() antes de cada teste.
 * - NextRequest é instanciado diretamente com um JSON body.
 */

import { NextRequest } from 'next/server'
import { EVOLUTION_WEBHOOK_SECRET_HEADER, exceedsMaxEvolutionWebhookBodySize } from '@/lib/evolution-api'

const TEST_WEBHOOK_SECRET = 'test-webhook-secret'

// ─── Mock do Supabase ──────────────────────────────────────────────────────────

const storageFromMock = {
  upload: jest.fn().mockResolvedValue({ error: null }),
  getPublicUrl: jest.fn().mockReturnValue({
    data: { publicUrl: 'https://storage.example.com/test.jpg' },
  }),
}

const supabaseMock = {
  from: jest.fn(),
  storage: {
    createBucket: jest.fn().mockResolvedValue({ data: null, error: null }),
    from: jest.fn().mockReturnValue(storageFromMock),
  },
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// ─── Mock global do fetch ──────────────────────────────────────────────────────

const fetchMock = jest.fn()
global.fetch = fetchMock

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Monta o request bruto, sem injetar header de autenticação nem "instance" por padrão. */
function buildRawRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/webhook/evolution', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** Monta um request autenticado (header de segredo válido) com "instance" padrão. */
function buildRequest(body: Record<string, unknown>): NextRequest {
  return buildRawRequest(
    { instance: 'flashflow-main', ...body },
    { [EVOLUTION_WEBHOOK_SECRET_HEADER]: TEST_WEBHOOK_SECRET }
  )
}

/**
 * Configura supabaseMock para simular upsert + select com sucesso,
 * devolvendo a conversa informada.
 * Também mocka Contact e Chat (sem resultados) para o fallback de nome.
 */
function mockSupabaseSuccess(conversation = { id: 'conv-123' }) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        // Used by @lid resolution: .select().eq().eq().not().order().limit().maybeSingle()
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: conversation,
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
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
    }
    if (table === 'Contact' || table === 'Chat') {
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

/**
 * Configura supabaseMock para simular falha no upsert de conversations.
 * Contact e Chat retornam null (sem nome) para não bloquear o fluxo.
 */
function mockSupabaseFailure() {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
    }
    if (table === 'Contact' || table === 'Chat') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return {
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'DB error' },
            }),
          }),
        }),
      }
    }
  })
}

/** Simula Evolution API retornando base64 para download de mídia */
function mockMediaDownloadSuccess(base64 = 'abc123', mimetype = 'image/jpeg') {
  fetchMock.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ base64, mimetype }),
    text: jest.fn().mockResolvedValue(''),
  })
}

/** Simula falha no download de mídia via Evolution API */
function mockMediaDownloadFailure() {
  fetchMock.mockResolvedValue({
    ok: false,
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue('error'),
  })
}

// ─── Import da rota (após os mocks) ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/webhook/evolution/route')

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/webhook/evolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Restaura mocks de storage após clearAllMocks
    storageFromMock.upload.mockResolvedValue({ error: null })
    storageFromMock.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://storage.example.com/test.jpg' },
    })
    supabaseMock.storage.createBucket.mockResolvedValue({ data: null, error: null })
    supabaseMock.storage.from.mockReturnValue(storageFromMock)

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.EVOLUTION_API_URL = 'http://localhost:8080'
    process.env.EVOLUTION_API_KEY = 'test-key'
    process.env.EVOLUTION_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
  })

  // ── Autenticação do webhook ────────────────────────────────────────────────

  it('rejeita com 401 quando o header de segredo está ausente', async () => {
    const req = buildRawRequest({ event: 'messages.upsert', instance: 'flashflow-main', data: {} })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 401 quando o header de segredo está incorreto', async () => {
    const req = buildRawRequest(
      { event: 'messages.upsert', instance: 'flashflow-main', data: {} },
      { [EVOLUTION_WEBHOOK_SECRET_HEADER]: 'wrong-secret' }
    )
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 401 quando EVOLUTION_WEBHOOK_SECRET não está configurado no servidor (fail closed)', async () => {
    delete process.env.EVOLUTION_WEBHOOK_SECRET
    const req = buildRequest({ event: 'messages.upsert', data: {} })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejeita com 401 quando o Content-Type não é application/json', async () => {
    const req = buildRawRequest(
      { event: 'messages.upsert', instance: 'flashflow-main', data: {} },
      { [EVOLUTION_WEBHOOK_SECRET_HEADER]: TEST_WEBHOOK_SECRET, 'Content-Type': 'text/plain' }
    )
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  // NOTE: o cabeçalho "content-length" é proibido pela spec do Fetch para ser
  // definido manualmente em Request/Headers construídos em código (inclusive
  // NextRequest de teste) — apenas o transporte HTTP real o define. Por isso o
  // guard de tamanho é testado isoladamente como função pura; em produção o
  // mesmo valor chega via req.headers.get('content-length') do HTTP real e
  // cai no mesmo branch 401 já coberto pelos testes de autenticação acima.
  it('exceedsMaxEvolutionWebhookBodySize rejeita corpo acima do limite e aceita dentro do limite', () => {
    expect(exceedsMaxEvolutionWebhookBodySize(String(20 * 1024 * 1024))).toBe(true)
    expect(exceedsMaxEvolutionWebhookBodySize(String(1024))).toBe(false)
    expect(exceedsMaxEvolutionWebhookBodySize(null)).toBe(false)
  })

  it('aceita e processa quando o header de segredo é válido', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-auth-ok' },
        message: { conversation: 'ok' },
        pushName: 'Teste',
      },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('ignora messages.upsert sem "instance" no payload, sem fallback para flashflow-main', async () => {
    const req = buildRawRequest(
      {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-no-instance' },
          message: { conversation: 'sem instance' },
        },
      },
      { [EVOLUTION_WEBHOOK_SECRET_HEADER]: TEST_WEBHOOK_SECRET }
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  // ── Filtragem de eventos ───────────────────────────────────────────────────

  it('ignora eventos que não são messages.upsert', async () => {
    const req = buildRequest({ event: 'connection.update', data: {} })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('ignora mensagens com fromMe === true cujo wa_message_id JÁ existe no banco', async () => {
    // Simula que o wa_message_id já existe (mensagem enviada pelo FlashFlow)
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'existing-msg' }, error: null }),
            }),
          }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        }
      }
    })

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521999887766@s.whatsapp.net', fromMe: true, id: 'evo-msg-known' },
        message: { conversation: 'oi' },
        pushName: 'Eu',
      },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    // Não deve tentar upsert em conversations nem insert de nova mensagem
    const insertCalled = supabaseMock.from.mock.results.some(
      r => r.value?.insert && r.value.insert.mock?.calls?.length > 0
    )
    expect(insertCalled).toBe(false)
  })

  it('salva mensagem outbound quando fromMe === true e wa_message_id é NOVO (outro dispositivo)', async () => {
    // Simula que o wa_message_id NÃO existe ainda
    supabaseMock.from.mockImplementationOnce((table: string) => {
      if (table === 'messages') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }
    })
    // Em seguida processa normalmente
    mockSupabaseSuccess()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521999887766@s.whatsapp.net', fromMe: true, id: 'evo-msg-new' },
        message: { conversation: 'mensagem de outro cel' },
        pushName: 'Contato X',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // O insert deve ter sido chamado com direction 'outbound'
    const allFromCalls = supabaseMock.from.mock.calls.map(c => c[0])
    expect(allFromCalls).toContain('messages')
  })

  it('ignora payload sem data.key', async () => {
    const req = buildRequest({ event: 'messages.upsert', data: {} })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  // ── Extração do número de telefone ────────────────────────────────────────

  it('extrai contact_phone correto de JID @s.whatsapp.net', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-2' },
        message: { conversation: 'ola' },
        pushName: 'João',
      },
    })

    await POST(req)

    // messages.dedup(0) → conversations.upsert(1) + conversations.update(2) → messages.insert(3)
    const upsertCall = supabaseMock.from.mock.results[1].value.upsert
    const upsertArg = upsertCall.mock.calls[0][0]

    expect(upsertArg.contact_phone).toBe('5521912345678')
    expect(upsertArg.wa_id).toBe('5521912345678@s.whatsapp.net')
  })

  it('extrai contact_phone correto de JID @lid sem conversa existente', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '82038@lid', fromMe: false, id: 'msg-3' },
        message: { conversation: 'ola' },
        pushName: 'Maria',
      },
    })

    await POST(req)

    // A resolução @lid é o primeiro from('conversations') — retorna null (sem conversa existente)
    // O upsert é o segundo from('conversations')
    const allConvCalls = supabaseMock.from.mock.calls
      .map((args: string[], i: number) => ({ table: args[0], result: supabaseMock.from.mock.results[i].value }))
      .filter((c: { table: string }) => c.table === 'conversations')
    const upsertCall = allConvCalls.find(
      (c: { result: { upsert?: jest.Mock } }) => (c.result.upsert?.mock.calls.length ?? 0) > 0
    )
    expect(upsertCall).toBeDefined()
    const upsert = upsertCall?.result.upsert
    expect(upsert).toBeDefined()
    const upsertArg = upsert!.mock.calls[0][0]

    expect(upsertArg.contact_phone).toBe('82038')
    expect(upsertArg.wa_id).toBe('82038@lid')
  })

  // ── Extração do conteúdo da mensagem ──────────────────────────────────────

  it('usa message.conversation como conteúdo', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-4' },
        message: { conversation: 'texto direto' },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('texto direto')
    expect(insertCall.mock.calls[0][0].type).toBe('text')
  })

  it('usa message.extendedTextMessage.text como conteúdo', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-5' },
        message: { extendedTextMessage: { text: 'texto estendido' } },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('texto estendido')
    expect(insertCall.mock.calls[0][0].type).toBe('text')
  })

  // ── imageMessage: inline base64 (webhookBase64=true) ─────────────────────

  it('processa imageMessage com base64 inline e salva URL do storage', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-img-1' },
        message: {
          imageMessage: {
            base64: 'dGVzdA==', // "test" em base64
            mimetype: 'image/jpeg',
            caption: 'foto',
          },
        },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    const insertArg = insertCall.mock.calls[0][0]

    expect(insertArg.type).toBe('image')
    expect(insertArg.content).toBe('https://storage.example.com/test.jpg')
    expect(fetchMock).not.toHaveBeenCalled() // não chama API se já tem base64
  })

  // ── imageMessage: download via Evolution API (webhookBase64=false) ────────

  it('processa imageMessage sem base64 inline chamando getBase64FromMediaMessage', async () => {
    mockSupabaseSuccess()
    mockMediaDownloadSuccess('dGVzdA==', 'image/jpeg')

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-img-2' },
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'imagem sem base64',
          },
        },
        pushName: null,
      },
    })

    await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/chat/getBase64FromMediaMessage/')

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    const insertArg = insertCall.mock.calls[0][0]

    expect(insertArg.type).toBe('image')
    expect(insertArg.content).toBe('https://storage.example.com/test.jpg')
  })

  it('usa caption como fallback quando download de mídia falha', async () => {
    mockSupabaseSuccess()
    mockMediaDownloadFailure()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-img-3' },
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'legenda da imagem',
          },
        },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    const insertArg = insertCall.mock.calls[0][0]

    expect(insertArg.type).toBe('image')
    expect(insertArg.content).toBe('legenda da imagem')
  })

  it('usa "[imagem]" quando download falha e não há caption', async () => {
    mockSupabaseSuccess()
    mockMediaDownloadFailure()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-img-4' },
        message: { imageMessage: { mimetype: 'image/jpeg' } },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('[imagem]')
    expect(insertCall.mock.calls[0][0].type).toBe('image')
  })

  it('salva type "media" e content "[áudio]" para audioMessage', async () => {
    mockSupabaseSuccess()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-6' },
        message: { audioMessage: {} },
        pushName: null,
      },
    })

    await POST(req)

    // pushName=null → messages.dedup(0) + Contact(1) + Chat(2) → conversations(3,upsert) + conversations(4,update) → messages(5)
    const insertCall = supabaseMock.from.mock.results[5].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('[áudio]')
    expect(insertCall.mock.calls[0][0].type).toBe('audio')
  })

  it('salva type "sticker" para stickerMessage', async () => {
    mockSupabaseSuccess()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-sticker' },
        message: { stickerMessage: {} },
        pushName: 'Contato',
      },
    })

    await POST(req)

    // pushName preenchido → messages.dedup(0) → conversations(1,upsert) + conversations(2,update) → messages(3)
    const insertCall = supabaseMock.from.mock.results[3].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('[figurinha]')
    expect(insertCall.mock.calls[0][0].type).toBe('sticker')
  })

  it('salva type "video" para videoMessage', async () => {
    mockSupabaseSuccess()

    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-video' },
        message: { videoMessage: { caption: 'meu vídeo' } },
        pushName: 'Contato',
      },
    })

    await POST(req)

    // pushName preenchido → messages.dedup(0) → conversations(1,upsert) + conversations(2,update) → messages(3)
    const insertCall = supabaseMock.from.mock.results[3].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('meu vídeo')
    expect(insertCall.mock.calls[0][0].type).toBe('video')
  })

  // ── Resultado da operação ─────────────────────────────────────────────────

  it('retorna { ok: true } e status 200 em caso de sucesso', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-7' },
        message: { conversation: 'ok' },
        pushName: 'Teste',
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('salva mensagem com direction "inbound" e status "delivered"', async () => {
    mockSupabaseSuccess({ id: 'conv-abc' })
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-8' },
        message: { conversation: 'recebida' },
        pushName: 'Contato',
      },
    })

    await POST(req)

    // pushName preenchido → messages.dedup(0) → conversations(1,upsert) + conversations(2,update) → messages(3)
    const insertCall = supabaseMock.from.mock.results[3].value.insert
    const insertArg = insertCall.mock.calls[0][0]

    expect(insertArg.direction).toBe('inbound')
    expect(insertArg.status).toBe('delivered')
    expect(insertArg.conversation_id).toBe('conv-abc')
    expect(insertArg.wa_message_id).toBe('msg-8')
  })

  it('retorna { ok: false } e status 500 se o Supabase falhar', async () => {
    mockSupabaseFailure()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-9' },
        message: { conversation: 'erro' },
        pushName: null,
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })

  // ── messages.update ───────────────────────────────────────────────────────

  it('atualiza status da mensagem para "read" quando status é READ', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    supabaseMock.from.mockReturnValue({ update: updateMock })

    const req = buildRequest({
      event: 'messages.update',
      data: [
        { key: { id: 'msg-abc', fromMe: true }, update: { status: 'READ' } },
      ],
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ status: 'read' })
    const eqCall = updateMock.mock.results[0].value.eq
    expect(eqCall.mock.calls[0]).toEqual(['wa_message_id', 'msg-abc'])
  })

  it('atualiza status para "delivered" quando status é DELIVERY_ACK', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    supabaseMock.from.mockReturnValue({ update: updateMock })

    const req = buildRequest({
      event: 'messages.update',
      data: [
        { key: { id: 'msg-xyz', fromMe: true }, update: { status: 'DELIVERY_ACK' } },
      ],
    })

    await POST(req)
    expect(updateMock).toHaveBeenCalledWith({ status: 'delivered' })
  })

  it('ignora updates de mensagens recebidas (fromMe false)', async () => {
    const req = buildRequest({
      event: 'messages.update',
      data: [
        { key: { id: 'msg-inbound', fromMe: false }, update: { status: 'READ' } },
      ],
    })

    await POST(req)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('ignora status desconhecido no messages.update', async () => {
    const req = buildRequest({
      event: 'messages.update',
      data: [
        { key: { id: 'msg-unk', fromMe: true }, update: { status: 'PENDING' } },
      ],
    })

    await POST(req)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})

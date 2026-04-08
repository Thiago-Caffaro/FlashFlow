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

// ─── Mock do Supabase ──────────────────────────────────────────────────────────

const supabaseMock = {
  from: jest.fn(),
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/webhook/evolution', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Configura supabaseMock para simular upsert + select com sucesso,
 * devolvendo a conversa informada.
 */
function mockSupabaseSuccess(conversation = { id: 'conv-123' }) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: conversation,
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
    }
  })
}

/**
 * Configura supabaseMock para simular falha no upsert de conversations.
 */
function mockSupabaseFailure() {
  supabaseMock.from.mockImplementation((table: string) => {
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

// ─── Import da rota (após os mocks) ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/webhook/evolution/route')

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/webhook/evolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
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

  it('ignora mensagens com fromMe === true', async () => {
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521999887766@s.whatsapp.net', fromMe: true, id: 'msg-1' },
        message: { conversation: 'oi' },
        pushName: 'Eu',
      },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(supabaseMock.from).not.toHaveBeenCalled()
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

    const upsertCall = supabaseMock.from.mock.results[0].value.upsert
    const upsertArg = upsertCall.mock.calls[0][0]

    expect(upsertArg.contact_phone).toBe('5521912345678')
    expect(upsertArg.wa_id).toBe('5521912345678@s.whatsapp.net')
  })

  it('extrai contact_phone correto de JID @lid', async () => {
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

    const upsertCall = supabaseMock.from.mock.results[0].value.upsert
    const upsertArg = upsertCall.mock.calls[0][0]

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

    const insertCall = supabaseMock.from.mock.results[1].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('texto direto')
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

    const insertCall = supabaseMock.from.mock.results[1].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('texto estendido')
  })

  it('usa "[mídia]" quando não há texto na mensagem', async () => {
    mockSupabaseSuccess()
    const req = buildRequest({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5521912345678@s.whatsapp.net', fromMe: false, id: 'msg-6' },
        message: { imageMessage: { url: 'http://...' } },
        pushName: null,
      },
    })

    await POST(req)

    const insertCall = supabaseMock.from.mock.results[1].value.insert
    expect(insertCall.mock.calls[0][0].content).toBe('[mídia]')
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

    const insertCall = supabaseMock.from.mock.results[1].value.insert
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
})

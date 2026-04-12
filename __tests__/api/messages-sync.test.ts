/**
 * Testes unitários para app/api/messages/sync/[conversationId]/route.ts
 *
 * A rota lê mensagens diretamente da tabela "Message" da Evolution API no Supabase,
 * em vez de chamar o endpoint HTTP. Os testes mockam o cliente Supabase.
 */

import { NextRequest } from 'next/server'

// ─── Mock do Supabase ──────────────────────────────────────────────────────────

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(conversationId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/messages/sync/${conversationId}`,
    { method: 'POST' }
  )
}

function makeParams(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) }
}

function evoRow(id: string, fromMe: boolean, text: string, ts = 1700000000, status = 'DELIVERY_ACK') {
  return {
    key: { remoteJid: '5511@s.whatsapp.net', fromMe, id },
    message: { conversation: text },
    messageType: 'conversation',
    messageTimestamp: ts,
    status,
  }
}

const REMOTE_JID = '5511@s.whatsapp.net'
const INSTANCE_ID = 'test-uuid-abc'

/**
 * Sets up a complete mock chain for the happy path:
 *   conversations(select) → Instance(select) → Message(select+chain) → messages(select, insert)
 *
 * The module-level instanceIdCache may short-circuit the Instance lookup on repeat calls —
 * that is expected behaviour and doesn't affect the assertions.
 */
function mockHappyPath(evoRows: unknown[] = [], existingWaIds: string[] = []) {
  let messagesCallCount = 0

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { wa_id: REMOTE_JID, instance_name: 'flashflow-main' },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'Instance') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: INSTANCE_ID },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'Message') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            filter: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: evoRows, error: null }),
              }),
            }),
          }),
        }),
      }
    }

    if (table === 'messages') {
      messagesCallCount++
      if (messagesCallCount === 1) {
        // First call: select existing wa_message_ids for dedup
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: existingWaIds.map((id) => ({ wa_message_id: id })),
                error: null,
              }),
            }),
          }),
        }
      }
      // Second call: insert
      return { insert: jest.fn().mockResolvedValue({ error: null }) }
    }
  })
}

/** Returns the insert mock from the last run (second 'messages' from() call). */
function getInsertedRows(): Array<Record<string, unknown>> {
  let messagesIdx = 0
  for (let i = 0; i < supabaseMock.from.mock.calls.length; i++) {
    if (supabaseMock.from.mock.calls[i][0] === 'messages') {
      messagesIdx++
      if (messagesIdx === 2) {
        return supabaseMock.from.mock.results[i].value.insert.mock.calls[0][0]
      }
    }
  }
  return []
}

// ─── Import (após os mocks) ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/messages/sync/[conversationId]/route')

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/messages/sync/[conversationId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  })

  // ── Guard: conversa não existe ────────────────────────────────────────────

  it('retorna { ok: false } se a conversa não existir', async () => {
    supabaseMock.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }))

    const res = await POST(buildRequest('nonexistent'), makeParams('nonexistent'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.added).toBe(0)
  })

  // ── Guard: instância não encontrada ───────────────────────────────────────

  it('retorna { ok: true, added: 0 } se o instanceId não for encontrado', async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                // Use a name that is guaranteed not in the module-level cache
                data: { wa_id: REMOTE_JID, instance_name: `missing-instance-${Date.now()}` },
                error: null,
              }),
            }),
          }),
        }
      }
      // Instance table: returns nothing
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    })

    const res = await POST(buildRequest('conv-1'), makeParams('conv-1'))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.added).toBe(0)
  })

  // ── Sem mensagens na tabela Message ──────────────────────────────────────

  it('retorna { ok: true, added: 0 } se Message não tiver registros para o JID', async () => {
    mockHappyPath([])
    const res = await POST(buildRequest('conv-1'), makeParams('conv-1'))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.added).toBe(0)
  })

  // ── Inserção de mensagens novas ───────────────────────────────────────────

  it('insere mensagens novas mapeando direção e conteúdo corretamente', async () => {
    mockHappyPath([
      evoRow('msg-in', false, 'oi', 1700000001, 'DELIVERY_ACK'),
      evoRow('msg-out', true, 'olá', 1700000002, 'READ'),
    ])

    const res = await POST(buildRequest('conv-1'), makeParams('conv-1'))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.added).toBe(2)

    const inserted = getInsertedRows()
    expect(inserted).toHaveLength(2)

    const inbound = inserted.find((m) => m.wa_message_id === 'msg-in')
    expect(inbound?.direction).toBe('inbound')
    expect(inbound?.content).toBe('oi')
    expect(inbound?.type).toBe('text')
    expect(inbound?.conversation_id).toBe('conv-1')

    const outbound = inserted.find((m) => m.wa_message_id === 'msg-out')
    expect(outbound?.direction).toBe('outbound')
    expect(outbound?.content).toBe('olá')
  })

  // ── Deduplicação ──────────────────────────────────────────────────────────

  it('não insere mensagens que já existem no banco (dedup por wa_message_id)', async () => {
    mockHappyPath(
      [
        evoRow('msg-dup', false, 'duplicada', 1700000001),
        evoRow('msg-new', false, 'nova', 1700000002),
      ],
      ['msg-dup'] // already in our messages table
    )

    const res = await POST(buildRequest('conv-1'), makeParams('conv-1'))
    const json = await res.json()
    expect(json.added).toBe(1)

    const inserted = getInsertedRows()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].wa_message_id).toBe('msg-new')
  })

  // ── Ordem cronológica ─────────────────────────────────────────────────────

  it('insere em ordem cronológica mesmo que a query retorne do mais novo para o mais antigo', async () => {
    // Evolution query uses ORDER BY messageTimestamp DESC — newest first
    mockHappyPath([
      evoRow('msg-newest', false, 'mais nova', 1700000010),
      evoRow('msg-oldest', false, 'mais antiga', 1700000001),
    ])

    await POST(buildRequest('conv-1'), makeParams('conv-1'))

    const inserted = getInsertedRows()
    expect(inserted[0].wa_message_id).toBe('msg-oldest')
    expect(inserted[1].wa_message_id).toBe('msg-newest')
  })

  // ── Mapeamento de status ──────────────────────────────────────────────────

  it('mapeia status da Evolution API corretamente', async () => {
    mockHappyPath([
      evoRow('m-read', true, 'lida', 1700000001, 'READ'),
      evoRow('m-delivered', false, 'entregue', 1700000002, 'DELIVERY_ACK'),
      evoRow('m-sent', true, 'enviada', 1700000003, 'SERVER_ACK'),
    ])

    await POST(buildRequest('conv-1'), makeParams('conv-1'))

    const inserted = getInsertedRows()
    expect(inserted.find((m) => m.wa_message_id === 'm-read')?.status).toBe('read')
    expect(inserted.find((m) => m.wa_message_id === 'm-delivered')?.status).toBe('delivered')
    expect(inserted.find((m) => m.wa_message_id === 'm-sent')?.status).toBe('sent')
  })

  // ── Tipos de mensagem ─────────────────────────────────────────────────────

  it('extrai conteúdo de imageMessage com caption', async () => {
    mockHappyPath([
      {
        key: { remoteJid: REMOTE_JID, fromMe: false, id: 'msg-img' },
        message: { imageMessage: { caption: 'foto bonita' } },
        messageType: 'imageMessage',
        messageTimestamp: 1700000001,
        status: 'DELIVERY_ACK',
      },
    ])

    await POST(buildRequest('conv-1'), makeParams('conv-1'))

    const inserted = getInsertedRows()
    expect(inserted[0].type).toBe('image')
    expect(inserted[0].content).toBe('foto bonita')
  })

  it('salva type "sticker" para stickerMessage', async () => {
    mockHappyPath([
      {
        key: { remoteJid: REMOTE_JID, fromMe: false, id: 'msg-sticker' },
        message: { stickerMessage: {} },
        messageType: 'stickerMessage',
        messageTimestamp: 1700000001,
        status: 'DELIVERY_ACK',
      },
    ])

    await POST(buildRequest('conv-1'), makeParams('conv-1'))

    const inserted = getInsertedRows()
    expect(inserted[0].content).toBe('[figurinha]')
    expect(inserted[0].type).toBe('sticker')
  })

  it('salva type "video" para videoMessage com caption', async () => {
    mockHappyPath([
      {
        key: { remoteJid: REMOTE_JID, fromMe: false, id: 'msg-video' },
        message: { videoMessage: { caption: 'legenda do vídeo' } },
        messageType: 'videoMessage',
        messageTimestamp: 1700000001,
        status: 'DELIVERY_ACK',
      },
    ])

    await POST(buildRequest('conv-1'), makeParams('conv-1'))

    const inserted = getInsertedRows()
    expect(inserted[0].type).toBe('video')
    expect(inserted[0].content).toBe('legenda do vídeo')
  })
})

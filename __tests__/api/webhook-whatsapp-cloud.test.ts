/**
 * Testes unitários para app/api/webhook/whatsapp-cloud/route.ts
 *
 * Espelha a estrutura de __tests__/api/webhook-evolution.test.ts: assinatura
 * HMAC real (não mockada) contra um segredo de teste conhecido, dedup,
 * upsert de conversa, isolamento entre instâncias (via phone_number_id).
 */

import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const TEST_APP_SECRET = 'app-secret-de-teste'
const TEST_VERIFY_TOKEN = 'verify-token-de-teste'

// ─── Mock do Supabase ──────────────────────────────────────────────────────────
// Mocka @supabase/supabase-js diretamente — cobre tanto lib/supabase-admin.ts
// (usado pela rota) quanto lib/whatsapp-cloud-credentials.ts (mesma origem).

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const mockResolveAndStoreCloudMedia = jest.fn()
jest.mock('@/lib/whatsapp-cloud-media', () => ({
  resolveAndStoreCloudMedia: (...args: unknown[]) => mockResolveAndStoreCloudMedia(...args),
}))

// ─── Helpers ───────────────────────────────────────────────────────────────────

function signBody(rawBody: string, secret = TEST_APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`
}

function buildRequest(body: unknown, opts: { signature?: string; noSignature?: boolean } = {}): NextRequest {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!opts.noSignature) {
    headers['x-hub-signature-256'] = opts.signature ?? signBody(rawBody)
  }
  return new NextRequest('http://localhost/api/webhook/whatsapp-cloud', {
    method: 'POST',
    body: rawBody,
    headers,
  })
}

function buildGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/webhook/whatsapp-cloud')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url, { method: 'GET' })
}

function messagesChangeValue(overrides: Record<string, unknown> = {}) {
  return {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: '123456', display_phone_number: '+551199999999' },
    contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: '5511988887777' }],
    messages: [{
      from: '5511988887777',
      id: 'wamid.TEST1',
      timestamp: '1700000000',
      type: 'text',
      text: { body: 'Olá' },
    }],
    ...overrides,
  }
}

function buildCloudPayload(valueOverrides: Record<string, unknown> = {}, entryId = 'waba-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: entryId,
      changes: [{ field: 'messages', value: messagesChangeValue(valueOverrides) }],
    }],
  }
}

/** Configura o mock para o fluxo feliz: credenciais encontradas, upsert de conversa ok. */
function mockSupabaseSuccess(opts: {
  phoneNumberId?: string
  instanceName?: string
  conversation?: Record<string, unknown>
  existingMessage?: Record<string, unknown> | null
} = {}) {
  const phoneNumberId = opts.phoneNumberId ?? '123456'
  const instanceName = opts.instanceName ?? 'wa-cloud-1'
  const conversation = opts.conversation ?? { id: 'conv-1', unread_count: 0 }

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'whatsapp_cloud_credentials') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { instance_name: instanceName, phone_number_id: phoneNumberId },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: opts.existingMessage ?? null, error: null }),
          }),
        }),
        insert: jest.fn().mockResolvedValue({ error: null }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    if (table === 'conversations') {
      return {
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: conversation, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    // Cascata de flow/sessão/gatilho (fire-and-forget) — sem mock explícito,
    // no-opa graciosamente dentro do try/catch da própria rota.
    return undefined
  })
}

// ─── Import da rota (após os mocks) ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require('@/app/api/webhook/whatsapp-cloud/route')

describe('GET /api/webhook/whatsapp-cloud (handshake)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = TEST_VERIFY_TOKEN
  })

  it('returns the challenge when mode and verify_token are correct', async () => {
    const req = buildGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'challenge-123' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('challenge-123')
  })

  it('returns 403 when verify_token is wrong', async () => {
    const req = buildGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': 'challenge-123' })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when verify_token is not configured on the server', async () => {
    delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN
    const req = buildGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'x' })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/webhook/whatsapp-cloud', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WHATSAPP_CLOUD_APP_SECRET = TEST_APP_SECRET
  })

  // ── Autenticação ──────────────────────────────────────────────────────────

  it('rejects with 401 when the signature is missing', async () => {
    const req = buildRequest(buildCloudPayload(), { noSignature: true })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the signature does not match the body (tampered)', async () => {
    const req = buildRequest(buildCloudPayload(), { signature: signBody('{"tampered":true}') })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('rejects with 401 when WHATSAPP_CLOUD_APP_SECRET is not configured (fail closed)', async () => {
    delete process.env.WHATSAPP_CLOUD_APP_SECRET
    const req = buildRequest(buildCloudPayload())
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects invalid JSON after authentication without accessing the database', async () => {
    const rawBody = '{invalid'
    const req = new NextRequest('http://localhost/api/webhook/whatsapp-cloud', {
      method: 'POST',
      body: rawBody,
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signBody(rawBody) },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  // ── Resolução de conta por phone_number_id ────────────────────────────────

  it('ignores the message when phone_number_id has no matching account (no crash)', async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_cloud_credentials') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }) }) }
      }
      return undefined
    })
    const req = buildRequest(buildCloudPayload())
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  // ── Dedup ──────────────────────────────────────────────────────────────────

  it('skips saving when wa_message_id already exists (dedup)', async () => {
    mockSupabaseSuccess({ existingMessage: { id: 'already-saved' } })
    const req = buildRequest(buildCloudPayload())
    await POST(req)

    const insertCalled = supabaseMock.from.mock.results.some(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    expect(insertCalled).toBe(false)
  })

  // ── Upsert de conversa / isolamento por instância ─────────────────────────

  it('resolves instance_name from phone_number_id and upserts the conversation under it', async () => {
    mockSupabaseSuccess({ phoneNumberId: '123456', instanceName: 'wa-cloud-1' })
    const req = buildRequest(buildCloudPayload())
    await POST(req)

    const convCall = supabaseMock.from.mock.results.find((r) => r.value?.upsert)
    const upsertArg = (convCall!.value.upsert as jest.Mock).mock.calls[0][0]
    expect(upsertArg.instance_name).toBe('wa-cloud-1')
  })

  it('two accounts with different phone_number_id never mix instance_name (isolation)', async () => {
    mockSupabaseSuccess({ phoneNumberId: '111111', instanceName: 'wa-conta-a' })
    await POST(buildRequest(buildCloudPayload({ metadata: { phone_number_id: '111111' } })))
    const firstUpsertArg = supabaseMock.from.mock.results.find((r) => r.value?.upsert)!.value.upsert.mock.calls[0][0]
    expect(firstUpsertArg.instance_name).toBe('wa-conta-a')

    jest.clearAllMocks()
    mockSupabaseSuccess({ phoneNumberId: '222222', instanceName: 'wa-conta-b' })
    await POST(buildRequest(buildCloudPayload({ metadata: { phone_number_id: '222222' } })))
    const secondUpsertArg = supabaseMock.from.mock.results.find((r) => r.value?.upsert)!.value.upsert.mock.calls[0][0]
    expect(secondUpsertArg.instance_name).toBe('wa-conta-b')
  })

  it('uses wa_id from contacts (not messages[].from) as the canonical remote id', async () => {
    mockSupabaseSuccess()
    const req = buildRequest(buildCloudPayload({
      contacts: [{ profile: { name: 'Cliente' }, wa_id: '5511900001111' }],
      messages: [{ from: '5511900001111', id: 'wamid.X', type: 'text', text: { body: 'oi' } }],
    }))
    await POST(req)

    const convCall = supabaseMock.from.mock.results.find((r) => r.value?.upsert)
    const upsertArg = (convCall!.value.upsert as jest.Mock).mock.calls[0][0]
    expect(upsertArg.wa_id).toBe('5511900001111')
    expect(upsertArg.wa_id).not.toContain('@') // sem sufixo de JID, diferente da Evolution
  })

  it('saves the inbound message with the text body as content', async () => {
    mockSupabaseSuccess()
    const req = buildRequest(buildCloudPayload())
    await POST(req)

    const msgCall = supabaseMock.from.mock.results.find(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    const insertArg = (msgCall!.value.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.content).toBe('Olá')
    expect(insertArg.type).toBe('text')
    expect(insertArg.direction).toBe('inbound')
    expect(insertArg.wa_message_id).toBe('wamid.TEST1')
  })

  it('falls back to a text placeholder for message types with no real handling (video/audio/sticker)', async () => {
    mockSupabaseSuccess()
    const req = buildRequest(buildCloudPayload({
      messages: [{ from: '5511988887777', id: 'wamid.VID1', type: 'video', video: { id: 'media-1' } }],
    }))
    await POST(req)

    const msgCall = supabaseMock.from.mock.results.find(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    const insertArg = (msgCall!.value.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.content).toBe('[vídeo]')
    expect(insertArg.type).toBe('video')
    expect(mockResolveAndStoreCloudMedia).not.toHaveBeenCalled()
  })

  // ── Imagem (Fase 2) ────────────────────────────────────────────────────────

  it('resolves image media via resolveAndStoreCloudMedia and stores the public URL as content', async () => {
    mockSupabaseSuccess({ phoneNumberId: '123456', instanceName: 'wa-cloud-1' })
    mockResolveAndStoreCloudMedia.mockResolvedValue('https://supabase.example/media/foto.jpg')
    const req = buildRequest(buildCloudPayload({
      messages: [{ from: '5511988887777', id: 'wamid.IMG1', type: 'image', image: { id: 'media-1' } }],
    }))
    await POST(req)

    expect(mockResolveAndStoreCloudMedia).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ instance_name: 'wa-cloud-1', phone_number_id: '123456' })
    )

    const msgCall = supabaseMock.from.mock.results.find(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    const insertArg = (msgCall!.value.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.content).toBe('https://supabase.example/media/foto.jpg')
    expect(insertArg.type).toBe('image')

    const convCall = supabaseMock.from.mock.results.find((r) => r.value?.upsert)
    const upsertArg = (convCall!.value.upsert as jest.Mock).mock.calls[0][0]
    expect(upsertArg.last_message).toBe('[imagem]')
  })

  it('falls back to the caption, then to a placeholder, when media resolution fails', async () => {
    mockSupabaseSuccess()
    mockResolveAndStoreCloudMedia.mockResolvedValue(null)
    const req = buildRequest(buildCloudPayload({
      messages: [{ from: '5511988887777', id: 'wamid.IMG2', type: 'image', image: { id: 'media-2', caption: 'legenda' } }],
    }))
    await POST(req)

    const msgCall = supabaseMock.from.mock.results.find(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    const insertArg = (msgCall!.value.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.content).toBe('legenda')
    expect(insertArg.type).toBe('image')
  })

  it('falls back to a fixed placeholder when media resolution fails and there is no caption', async () => {
    mockSupabaseSuccess()
    mockResolveAndStoreCloudMedia.mockResolvedValue(null)
    const req = buildRequest(buildCloudPayload({
      messages: [{ from: '5511988887777', id: 'wamid.IMG3', type: 'image', image: { id: 'media-3' } }],
    }))
    await POST(req)

    const msgCall = supabaseMock.from.mock.results.find(
      (r) => r.value?.insert && (r.value.insert as jest.Mock).mock?.calls?.length > 0
    )
    const insertArg = (msgCall!.value.insert as jest.Mock).mock.calls[0][0]
    expect(insertArg.content).toBe('[imagem]')
    expect(insertArg.type).toBe('image')
  })

  // ── Status updates de mensagens enviadas ──────────────────────────────────

  it('maps a delivered status update to messages.status by wa_message_id', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null })
    const updateMock = jest.fn().mockReturnValue({ eq: updateEqMock })
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_cloud_credentials') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { instance_name: 'wa-1', phone_number_id: '123456' }, error: null }) }) }) }
      }
      if (table === 'messages') return { update: updateMock }
      return undefined
    })

    const req = buildRequest(buildCloudPayload({
      messages: undefined,
      statuses: [{ id: 'wamid.OUT1', status: 'delivered', recipient_id: '5511988887777', timestamp: '1700000000' }],
    }))
    await POST(req)

    expect(updateMock).toHaveBeenCalledWith({ status: 'delivered' })
    expect(updateEqMock).toHaveBeenCalledWith('wa_message_id', 'wamid.OUT1')
  })

  // Payload real capturado em produção (número de teste da Meta, erro 130497
  // "restricted from messaging users in this country"): contacts[] sem
  // "profile" (só wa_id/user_id) e um evento só de status, sem "messages".
  it('handles a real failed-status payload with no contacts[].profile and no messages[] without crashing', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null })
    const updateMock = jest.fn().mockReturnValue({ eq: updateEqMock })
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_cloud_credentials') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { instance_name: 'wa-1', phone_number_id: '1250328381499426' }, error: null }) }) }) }
      }
      if (table === 'messages') return { update: updateMock }
      return undefined
    })

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '1347305600906204',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15552010992', phone_number_id: '1250328381499426' },
            contacts: [{ wa_id: '5521983935354', user_id: 'BR.1068481995879422' }],
            statuses: [{
              id: 'wamid.HBgNNTUyMTk4MzkzNTM1NBUCABEYEjBEMzhBNDFGODA1OTY3QUFENgA=',
              status: 'failed',
              timestamp: '1786718166',
              recipient_id: '5521983935354',
              recipient_logical_id: '186573530333335',
              recipient_user_id: 'BR.1068481995879422',
              errors: [{
                code: 130497,
                title: 'Business account is restricted from messaging users in this country.',
                message: 'Business account is restricted from messaging users in this country.',
                error_data: { details: 'Business account is restricted from messaging users in this country.' },
                href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
              }],
              internal_1p_only_data: {
                webhook_extra_data: 'FQAWpN65zr/g0w8W0PK/rtq+LTa4z/f7wNfkBBgJZ3JhcGhfYXBpTBbEoMGw2Mq4BBa4z/f7wNfkBBak3rnOv+DTDyUCAAA=',
                account_context: { cs_id: '1250328381499426', pma_id: '1347305600906204', app_id: '4406301386291090', account_context_type: 'paid_messaging' },
              },
            }],
          },
        }],
      }],
    }

    const res = await POST(buildRequest(payload))

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ status: 'failed' })
    expect(updateEqMock).toHaveBeenCalledWith(
      'wa_message_id',
      'wamid.HBgNNTUyMTk4MzkzNTM1NBUCABEYEjBEMzhBNDFGODA1OTY3QUFENgA='
    )
  })

  // ── Resultado geral ────────────────────────────────────────────────────────

  it('returns { ok: true } and 200 on success', async () => {
    mockSupabaseSuccess()
    const req = buildRequest(buildCloudPayload())
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('ignores changes with field other than "messages"', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: {} }] }],
    }
    const req = buildRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})

/**
 * Testes para app/api/media/proxy/route.ts (P10 da varredura de segurança):
 * remoteJid/instance/fromMe são derivados da mensagem no banco, nunca
 * confiados diretamente dos parâmetros da URL.
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/media/proxy/route')

function req(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return new NextRequest(`http://localhost/api/media/proxy?${qs}`)
}

function mockMessageAndConversation(opts: {
  found?: boolean
  direction?: 'inbound' | 'outbound'
  waId?: string
  instanceName?: string
} = {}) {
  const { found = true, direction = 'inbound', waId = '5521912345678@s.whatsapp.net', instanceName = 'inst-a' } = opts
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'messages') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: found ? { direction, conversation_id: 'conv-1' } : null,
                }),
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: found ? { wa_id: waId, instance_name: instanceName } : null,
            }),
          }),
        }),
      }
    }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EVOLUTION_API_URL = 'http://localhost:8080'
  process.env.EVOLUTION_API_KEY = 'test-key'
})

describe('GET /api/media/proxy', () => {
  it('retorna 400 sem id', async () => {
    const res = await GET(req({}))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retorna 404 quando a mensagem não existe no banco', async () => {
    mockMessageAndConversation({ found: false })
    const res = await GET(req({ id: 'msg-1', remoteJid: 'atacante@s.whatsapp.net', instance: 'inst-b' }))
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignora remoteJid/instance/fromMe da query e usa os dados da mensagem no banco', async () => {
    mockMessageAndConversation({ direction: 'inbound', waId: '5521900000000@s.whatsapp.net', instanceName: 'inst-real' })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ base64: 'aGVsbG8=' }),
    })

    await GET(req({
      id: 'msg-1',
      remoteJid: 'forjado@s.whatsapp.net',
      instance: 'inst-forjada',
      fromMe: 'true',
      type: 'imageMessage',
    }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/chat/getBase64FromMediaMessage/inst-real')
    const sentBody = JSON.parse(options.body)
    expect(sentBody.message.key.remoteJid).toBe('5521900000000@s.whatsapp.net')
    expect(sentBody.message.key.fromMe).toBe(false) // direction inbound -> fromMe false, não o "true" da query
  })

  it('retorna a imagem com header X-Content-Type-Options: nosniff', async () => {
    mockMessageAndConversation()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ base64: 'aGVsbG8=' }) })

    const res = await GET(req({ id: 'msg-1', type: 'stickerMessage' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toContain('private')
  })
})

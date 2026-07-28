/**
 * Testes para app/api/conversations/route.ts — GET /api/conversations?instance=xxx.
 *
 * Esta rota existe para que o frontend nunca precise ler a tabela
 * "conversations" diretamente com a anon key do Supabase (ver P5 da
 * varredura de segurança). Ela roda atrás do proxy.ts (cookie ff_auth) e usa
 * a service role no servidor.
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/conversations/route')

function buildRequest(instance?: string): NextRequest {
  const url = instance
    ? `http://localhost/api/conversations?instance=${encodeURIComponent(instance)}`
    : 'http://localhost/api/conversations'
  return new NextRequest(url)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/conversations', () => {
  it('retorna 400 quando "instance" está ausente', async () => {
    const res = await GET(buildRequest())
    expect(res.status).toBe(400)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('retorna as conversas da instância pedida, filtrando por instance_name no servidor', async () => {
    const rows = [{ id: 'c1', instance_name: 'inst-a', wa_id: 'x@s.whatsapp.net' }]
    const orderMock = jest.fn().mockResolvedValue({ data: rows, error: null })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    supabaseMock.from.mockReturnValue({ select: selectMock })

    const res = await GET(buildRequest('inst-a'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, conversations: rows })
    expect(supabaseMock.from).toHaveBeenCalledWith('conversations')
    expect(eqMock).toHaveBeenCalledWith('instance_name', 'inst-a')
  })

  it('retorna 500 quando o Supabase falha', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    supabaseMock.from.mockReturnValue({ select: jest.fn().mockReturnValue({ eq: eqMock }) })

    const res = await GET(buildRequest('inst-a'))
    expect(res.status).toBe(500)
  })

  it('não vaza dados de outras instâncias — só filtra pela instância pedida', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [], error: null })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    supabaseMock.from.mockReturnValue({ select: jest.fn().mockReturnValue({ eq: eqMock }) })

    await GET(buildRequest('inst-b'))
    expect(eqMock).toHaveBeenCalledWith('instance_name', 'inst-b')
    expect(eqMock).not.toHaveBeenCalledWith('instance_name', 'inst-a')
  })
})

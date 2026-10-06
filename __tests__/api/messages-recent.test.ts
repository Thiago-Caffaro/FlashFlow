import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result) {
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain as Record<string, jest.Mock>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/messages/route')

function request(query: string) {
  return new NextRequest(`http://localhost/api/messages?conversationId=conv-1&instance=wa-1${query}`)
}

describe('GET /api/messages', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns only the newest N messages in chronological order when ?recent is set', async () => {
    const messages = builder({
      data: [
        { id: 'm3', created_at: '2026-10-02T10:03:00.000Z' },
        { id: 'm2', created_at: '2026-10-02T10:02:00.000Z' },
      ],
      error: null,
    })
    supabaseMock.from
      .mockReturnValueOnce(builder({ data: { instance_name: 'wa-1' }, error: null }))
      .mockReturnValueOnce(messages)

    const res = await GET(request('&recent=2'))
    const json = await res.json()

    expect(messages.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(messages.limit).toHaveBeenCalledWith(2)
    expect(json.messages.map((m: { id: string }) => m.id)).toEqual(['m2', 'm3'])
  })

  it('caps ?recent and keeps the full history when it is absent or invalid', async () => {
    const capped = builder({ data: [], error: null })
    const full = builder({ data: [{ id: 'm1' }], error: null })
    supabaseMock.from
      .mockReturnValueOnce(builder({ data: { instance_name: 'wa-1' }, error: null }))
      .mockReturnValueOnce(capped)
      .mockReturnValueOnce(builder({ data: { instance_name: 'wa-1' }, error: null }))
      .mockReturnValueOnce(full)

    await GET(request('&recent=5000'))
    await GET(request('&recent=abc'))

    expect(capped.limit).toHaveBeenCalledWith(100)
    expect(full.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(full.limit).not.toHaveBeenCalled()
  })
})

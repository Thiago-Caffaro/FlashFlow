import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const collectionRoute = require('@/app/api/message-variables/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const itemRoute = require('@/app/api/message-variables/[id]/route')

function resultBuilder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'order']) chain[method] = jest.fn(() => chain)
  for (const method of ['insert', 'update', 'delete']) chain[method] = jest.fn(() => chain)
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain
}

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('message variables API', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lists variables only for the requested WhatsApp account', async () => {
    const query = resultBuilder({
      data: [{ id: 'var-1', instance_name: 'wa-a', key: 'loja' }],
      error: null,
    })
    supabaseMock.from.mockReturnValue(query)

    const response = await collectionRoute.GET(request('/api/message-variables?instance=wa-a', 'GET'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.variables).toHaveLength(1)
    expect(query.eq).toHaveBeenCalledWith('instance_name', 'wa-a')
  })

  it('creates a valid custom variable and rejects an invalid key', async () => {
    const query = resultBuilder({
      data: { id: 'var-1', instance_name: 'wa-a', key: 'nome_loja' },
      error: null,
    })
    supabaseMock.from.mockReturnValue(query)

    const created = await collectionRoute.POST(request('/api/message-variables', 'POST', {
      instance_name: 'wa-a',
      key: 'nome_loja',
      label: 'Nome da loja',
      value: 'Loja Exemplo',
    }))
    expect(created.status).toBe(201)

    const invalid = await collectionRoute.POST(request('/api/message-variables', 'POST', {
      instance_name: 'wa-a',
      key: 'Nome com espaco',
      label: 'Nome',
      value: 'Loja',
    }))
    expect(invalid.status).toBe(400)
  })

  it('does not update a variable owned by another account', async () => {
    const ownership = resultBuilder({ data: { instance_name: 'wa-b' }, error: null })
    supabaseMock.from.mockReturnValue(ownership)

    const response = await itemRoute.PUT(
      request('/api/message-variables/var-1', 'PUT', {
        instance_name: 'wa-a',
        label: 'Tentativa',
      }),
      { params: Promise.resolve({ id: 'var-1' }) }
    )
    expect(response.status).toBe(404)
  })

  it('deletes a variable only after ownership validation', async () => {
    const ownership = resultBuilder({ data: { instance_name: 'wa-a' }, error: null })
    const deletion = resultBuilder({ data: null, error: null })
    supabaseMock.from
      .mockReturnValueOnce(ownership)
      .mockReturnValueOnce(deletion)

    const response = await itemRoute.DELETE(
      request('/api/message-variables/var-1?instance=wa-a', 'DELETE'),
      { params: Promise.resolve({ id: 'var-1' }) }
    )
    expect(response.status).toBe(200)
    expect(deletion.delete).toHaveBeenCalled()
  })
})

import { clearRoutes, route } from '@/lib/demo/router'
import { createDemoFetch } from '@/lib/demo/install'

const ORIGIN = 'https://demo.test'

describe('fetch da demo', () => {
  const original = jest.fn(async () => new Response('original'))
  let demoFetch: typeof fetch

  beforeEach(() => {
    clearRoutes()
    original.mockClear()
    demoFetch = createDemoFetch(original as unknown as typeof fetch, '/FlashFlow', ORIGIN)
  })

  it('responde a /api/* sem tocar na rede', async () => {
    route('GET', '/api/x', () => ({ json: { ok: true, n: 1 } }))
    const res = await demoFetch('/api/x')
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ ok: true, n: 1 })
    expect(original).not.toHaveBeenCalled()
  })

  it('aceita o caminho já prefixado com o basePath e URLs absolutas da mesma origem', async () => {
    route('GET', '/api/x', () => ({ json: { ok: true } }))
    expect((await demoFetch('/FlashFlow/api/x')).status).toBe(200)
    expect((await demoFetch(`${ORIGIN}/api/x?a=1`)).status).toBe(200)
    expect(original).not.toHaveBeenCalled()
  })

  it('deixa passar pedidos que não são da API', async () => {
    await demoFetch('/FlashFlow/_next/static/chunk.js')
    await demoFetch('https://fonts.example/api/x')
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('entrega corpo JSON e FormData ao handler', async () => {
    const seen: unknown[] = []
    route('POST', '/api/y', (req) => { seen.push(req.body); return { json: { ok: true } } })
    await demoFetch('/api/y', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    const form = new FormData()
    form.append('caption', 'olá')
    await demoFetch('/api/y', { method: 'POST', body: form })
    expect(seen[0]).toEqual({ a: 1 })
    expect(seen[1]).toBeInstanceOf(FormData)
  })

  it('reflete o status de erro em Response.ok', async () => {
    const res = await demoFetch('/api/sem-handler', { method: 'POST', body: '{}' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
  })
})

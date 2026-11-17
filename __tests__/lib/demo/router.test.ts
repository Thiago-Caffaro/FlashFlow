import { clearRoutes, dispatch, route } from '@/lib/demo/router'
import { DEMO_WRITE_BLOCKED_MESSAGE } from '@/lib/demo/config'

describe('router da demo', () => {
  beforeEach(() => clearRoutes())

  it('casa parâmetros e entrega-os descodificados', async () => {
    route('GET', '/api/accounts/:name/status', (req) => ({ json: { ok: true, name: req.params.name } }))
    const result = await dispatch('GET', '/api/accounts/minha%20conta/status?x=1', undefined)
    expect(result.json).toEqual({ ok: true, name: 'minha conta' })
  })

  it('ignora a query string no casamento e expõe-a ao handler', async () => {
    route('GET', '/api/notifications', (req) => ({ json: { ok: true, instance: req.query.get('instance') } }))
    const result = await dispatch('GET', '/api/notifications?instance=loja&countOnly=1', undefined)
    expect(result.json).toEqual({ ok: true, instance: 'loja' })
  })

  it('distingue o método', async () => {
    route('GET', '/api/flows', () => ({ json: { ok: true, via: 'get' } }))
    route('POST', '/api/flows', (req) => ({ json: { ok: true, via: 'post', body: req.body } }))
    expect((await dispatch('POST', '/api/flows', { name: 'x' })).json).toEqual({ ok: true, via: 'post', body: { name: 'x' } })
  })

  it('prefere a rota literal à rota com parâmetro', async () => {
    route('GET', '/api/flows/:id', () => ({ json: { ok: true, via: 'param' } }))
    route('GET', '/api/flows/export', () => ({ json: { ok: true, via: 'literal' } }))
    expect((await dispatch('GET', '/api/flows/export', undefined)).json.via).toBe('literal')
  })

  it('GET desconhecido responde ok sem dados', async () => {
    const result = await dispatch('GET', '/api/nao-existe', undefined)
    expect(result.status ?? 200).toBe(200)
    expect(result.json).toEqual({ ok: true })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s desconhecido é recusado com a mensagem da demo', async (method) => {
    const result = await dispatch(method, '/api/nao-existe', {})
    expect(result.status).toBe(400)
    expect(result.json).toEqual({ ok: false, error: DEMO_WRITE_BLOCKED_MESSAGE })
  })

  it('um handler que rebenta devolve 500 em vez de rejeitar', async () => {
    route('GET', '/api/boom', () => { throw new Error('boom') })
    const result = await dispatch('GET', '/api/boom', undefined)
    expect(result.status).toBe(500)
    expect(result.json.ok).toBe(false)
  })
})

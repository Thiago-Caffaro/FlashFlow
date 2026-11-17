import { registerDemoHandlers } from '@/lib/demo/handlers'
import { dispatch } from '@/lib/demo/router'
import { resetStore } from '@/lib/demo/store'
import type { Account } from '@/types'

describe('demo: auth e contas', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => resetStore())

  it('a sessão é sempre válida, por isso o login nunca aparece', async () => {
    expect((await dispatch('GET', '/api/auth/verify', undefined)).json).toEqual({ ok: true })
  })

  it('lista uma conta Evolution e uma Cloud API ligadas, mais a conta de sandbox', async () => {
    const { json } = await dispatch('GET', '/api/accounts', undefined)
    const accounts = json.accounts as Account[]
    const real = accounts.filter((a) => !a.isSandbox)
    expect(real.map((a) => a.provider).sort()).toEqual(['cloud_api', 'evolution'])
    expect(real.every((a) => a.state === 'open')).toBe(true)
    expect(accounts.filter((a) => a.isSandbox)).toHaveLength(1)
  })

  it('devolve o estado de uma conta e 404-equivalente para uma desconhecida', async () => {
    const { json } = await dispatch('GET', '/api/accounts', undefined)
    const first = (json.accounts as Account[])[0]
    const status = await dispatch('GET', `/api/accounts/${encodeURIComponent(first.instanceName)}/status`, undefined)
    expect(status.json.state).toBe('open')
    expect((await dispatch('GET', '/api/accounts/nao-existe/status', undefined)).json.state).toBe('close')
  })

  it('criar ou apagar contas não está disponível', async () => {
    expect((await dispatch('POST', '/api/accounts', { label: 'x' })).status).toBe(400)
    expect((await dispatch('DELETE', '/api/accounts/loja-es', undefined)).status).toBe(400)
  })

  it('sincronizações respondem ok sem fazer nada', async () => {
    expect((await dispatch('POST', '/api/sync', {})).json.ok).toBe(true)
    expect((await dispatch('POST', '/api/sync/initial', {})).json.ok).toBe(true)
  })
})

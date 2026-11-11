/** Fluxos gerados por automação (migration 030): fora da lista e travados no editor. */

import { NextRequest } from 'next/server'

type Result = { data: unknown; error: null }
const calls: Array<{ method: string; args: unknown[] }> = []
let managedBy: string | null = null

function chain(result: Result) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'update', 'delete']) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder }
  }
  builder.single = async () => result
  builder.maybeSingle = async () => ({ data: { managed_by_automation_id: managedBy }, error: null })
  builder.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve)
  return builder
}

const supabaseMock = { from: jest.fn(() => chain({ data: [], error: null })) }
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => supabaseMock) }))
jest.mock('@/lib/instance-guard', () => ({ belongsToInstance: jest.fn(async () => true) }))

/* eslint-disable @typescript-eslint/no-require-imports */
const listRoute = require('@/app/api/flows/route')
const itemRoute = require('@/app/api/flows/[id]/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const params = { params: Promise.resolve({ id: 'flow-1' }) }

beforeEach(() => {
  calls.length = 0
  managedBy = null
})

describe('fluxos gerados por automação', () => {
  it('GET /api/flows filtra os fluxos gerados', async () => {
    const res = await listRoute.GET(new NextRequest('http://localhost/api/flows?instance=inst-a'))
    expect(res.status).toBe(200)
    expect(calls).toContainEqual({ method: 'is', args: ['managed_by_automation_id', null] })
  })

  it('PUT recusa editar fluxo gerado', async () => {
    managedBy = 'auto-1'
    const res = await itemRoute.PUT(new NextRequest('http://localhost/api/flows/flow-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_name: 'inst-a', name: 'x' }),
    }), params)
    expect(res.status).toBe(409)
    expect(calls.some((call) => call.method === 'update')).toBe(false)
  })

  it('DELETE recusa apagar fluxo gerado', async () => {
    managedBy = 'auto-1'
    const res = await itemRoute.DELETE(new NextRequest('http://localhost/api/flows/flow-1?instance=inst-a', { method: 'DELETE' }), params)
    expect(res.status).toBe(409)
    expect(calls.some((call) => call.method === 'delete')).toBe(false)
  })

  it('fluxo comum continua editável', async () => {
    const res = await itemRoute.PUT(new NextRequest('http://localhost/api/flows/flow-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_name: 'inst-a', name: 'x' }),
    }), params)
    expect(res.status).toBe(200)
  })
})

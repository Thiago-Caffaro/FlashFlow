import { registerDemoHandlers } from '@/lib/demo/handlers'
import { dispatch } from '@/lib/demo/router'
import { resetStore } from '@/lib/demo/store'
import { DEMO_WRITE_BLOCKED_MESSAGE } from '@/lib/demo/config'
import { DEMO_INSTANCE_ES } from '@/lib/demo/seed/accounts'
import type { AgentMemoryBlock } from '@/types'

describe('demo: ecrãs de configuração', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => resetStore())

  it.each([
    ['/api/ai-keys', 'configured'],
    [`/api/instance-ai-config?instance=${DEMO_INSTANCE_ES}`, 'config'],
    ['/api/integrations/slack', 'status'],
    [`/api/integrations/slack/settings?instance=${DEMO_INSTANCE_ES}`, 'settings'],
    ['/api/integrations/slack/channels', 'channels'],
    ['/api/settings/shopify', 'clientId'],
    ['/api/settings/lightfunnels', 'clientId'],
    [`/api/memory-blocks?instance=${DEMO_INSTANCE_ES}`, 'blocks'],
  ])('%s devolve dados de exemplo', async (path, key) => {
    const { json } = await dispatch('GET', path, undefined)
    expect(json.ok).toBe(true)
    const value = json[key]
    expect(value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)).toBe(false)
  })

  it('nenhuma chave ou segredo real aparece: só o estado "configurada"', async () => {
    const text = JSON.stringify((await dispatch('GET', '/api/ai-keys', undefined)).json)
    expect(text).not.toMatch(/sk-|AIza|xox[bp]-/)
    expect((await dispatch('GET', '/api/settings/shopify', undefined)).json.clientSecretSet).toBe(true)
  })

  it.each([
    ['PUT', '/api/ai-keys/openai'],
    ['DELETE', '/api/ai-keys/openai'],
    ['POST', '/api/ai-keys/test/openai'],
    ['PUT', '/api/integrations/slack'],
    ['POST', '/api/integrations/slack/test'],
    ['PUT', '/api/settings/shopify'],
    ['POST', '/api/shopify/auth'],
    ['POST', '/api/diagnostics/send'],
  ])('%s %s é recusado com a mensagem da demo', async (method, path) => {
    const result = await dispatch(method, path, {})
    expect(result.status).toBe(400)
    expect(result.json).toEqual({ ok: false, error: DEMO_WRITE_BLOCKED_MESSAGE })
  })

  it('blocos de memória: os referenciados pelos fluxos existem e o CRUD funciona', async () => {
    const path = `/api/memory-blocks?instance=${DEMO_INSTANCE_ES}`
    const blocks = (await dispatch('GET', path, undefined)).json.blocks as AgentMemoryBlock[]
    expect(blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['mem-envios', 'mem-devolucoes']))
    const created = (await dispatch('POST', '/api/memory-blocks', {
      instance_name: DEMO_INSTANCE_ES, name: 'Garantia', content: '2 anos', type: 'contextual', keywords: ['garantía'],
    })).json.block as AgentMemoryBlock
    await dispatch('PUT', `/api/memory-blocks/${created.id}`, { content: '3 anos', instance_name: DEMO_INSTANCE_ES })
    const after = (await dispatch('GET', path, undefined)).json.blocks as AgentMemoryBlock[]
    expect(after.find((b) => b.id === created.id)?.content).toBe('3 anos')
    await dispatch('DELETE', `/api/memory-blocks/${created.id}?instance=${DEMO_INSTANCE_ES}`, undefined)
    expect(((await dispatch('GET', path, undefined)).json.blocks as AgentMemoryBlock[]).length).toBe(blocks.length)
  })

  it('o diagnóstico mostra as contas de exemplo ligadas', async () => {
    const { json } = await dispatch('GET', '/api/diagnostics', undefined)
    expect((json.accounts as unknown[]).length).toBeGreaterThan(0)
    expect(Array.isArray(json.recentWebhooks)).toBe(true)
    expect(Array.isArray(json.recentMessages)).toBe(true)
  })
})

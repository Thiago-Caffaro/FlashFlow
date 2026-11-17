import { registerDemoHandlers } from '@/lib/demo/handlers'
import { dispatch } from '@/lib/demo/router'
import { resetStore } from '@/lib/demo/store'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from '@/lib/demo/seed/accounts'
import { validateFlowJson } from '@/lib/flow-validation'
import type { AutomationWithSteps, Flow, ProductLineWithProducts, Trigger } from '@/types'

const flowsOf = async (instance: string) =>
  (await dispatch('GET', `/api/flows?instance=${instance}`, undefined)).json.flows as Flow[]

const linesOf = async () => (await dispatch('GET', '/api/product-lines', undefined)).json.lines as ProductLineWithProducts[]

describe('demo: fluxos, gatilhos e automações', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => resetStore())

  it('tem 3 fluxos de exemplo que passam na validação real', async () => {
    const flows = [...(await flowsOf(DEMO_INSTANCE_ES)), ...(await flowsOf(DEMO_INSTANCE_PT))]
    expect(flows).toHaveLength(3)
    for (const flow of flows) {
      expect(validateFlowJson(flow.json)).toEqual({ ok: true })
      expect(flow.json.nodes.length).toBeGreaterThan(3)
    }
  })

  it('cria, edita e apaga um fluxo', async () => {
    const created = (await dispatch('POST', '/api/flows', { instance_name: DEMO_INSTANCE_ES, name: 'Novo Fluxo' })).json.flow as Flow
    expect(created).toMatchObject({ name: 'Novo Fluxo', ativo: false, json: { nodes: [], edges: [] } })
    expect((await flowsOf(DEMO_INSTANCE_ES)).some((f) => f.id === created.id)).toBe(true)

    const json = { nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [] }
    const updated = await dispatch('PUT', `/api/flows/${created.id}`, { name: 'Renomeado', ativo: true, json, instance_name: DEMO_INSTANCE_ES })
    expect(updated.json.flow).toMatchObject({ name: 'Renomeado', ativo: true, json })

    await dispatch('DELETE', `/api/flows/${created.id}?instance=${DEMO_INSTANCE_ES}`, undefined)
    expect((await flowsOf(DEMO_INSTANCE_ES)).some((f) => f.id === created.id)).toBe(false)
  })

  it('recusa um fluxo inválido como a rota real', async () => {
    const result = await dispatch('POST', '/api/flows', { instance_name: DEMO_INSTANCE_ES, name: 'x', json: { nodes: 'não é lista', edges: [] } })
    expect(result.status).toBe(422)
    expect(result.json.ok).toBe(false)
  })

  it('gatilhos: lista por conta e faz CRUD', async () => {
    const path = `/api/triggers?instance=${DEMO_INSTANCE_ES}`
    const before = (await dispatch('GET', path, undefined)).json.triggers as Trigger[]
    expect(before.length).toBeGreaterThan(0)
    const created = (await dispatch('POST', '/api/triggers', {
      instance_name: DEMO_INSTANCE_ES, alias: 'Preço', tipo: 'contains', valor: 'precio', delay_ms: 0,
      action: 'send_message', action_payload: { message: 'Son 39,90 €' }, source: 'message',
    })).json.trigger as Trigger
    expect(created.id).toBeTruthy()
    await dispatch('PUT', `/api/triggers/${created.id}`, { valor: 'cuánto', instance_name: DEMO_INSTANCE_ES })
    const after = (await dispatch('GET', path, undefined)).json.triggers as Trigger[]
    expect(after.find((t) => t.id === created.id)?.valor).toBe('cuánto')
    await dispatch('DELETE', `/api/triggers/${created.id}?instance=${DEMO_INSTANCE_ES}`, undefined)
    expect(((await dispatch('GET', path, undefined)).json.triggers as Trigger[]).length).toBe(before.length)
  })

  it('automações: cria com passos, liga/desliga e apaga', async () => {
    const list = async () => (await dispatch('GET', '/api/automations', undefined)).json.automations as AutomationWithSteps[]
    expect(await list()).toHaveLength(2)
    const created = (await dispatch('POST', '/api/automations', {
      name: 'Entregue', kind: 'delivery_status', platform: 'shopify', country: 'ES', product_line_id: null,
      instance_name: DEMO_INSTANCE_ES, enabled: true, config: { statuses: ['Entregue'] },
      steps: [{ delay_minutes: 0, message: 'Gracias', fallback_template_id: null, fallback_template_variable_map: {} }],
    })).json.automation as AutomationWithSteps
    expect(created.steps).toHaveLength(1)
    expect(created.steps[0]).toMatchObject({ automation_id: created.id, position: 0, message: 'Gracias' })
    const toggled = (await dispatch('PATCH', `/api/automations/${created.id}`, { enabled: false })).json.automation as AutomationWithSteps
    expect(toggled.enabled).toBe(false)
    await dispatch('DELETE', `/api/automations/${created.id}`, undefined)
    expect(await list()).toHaveLength(2)
  })

  it('linhas de produto: linha, produto e vínculo de catálogo', async () => {
    const before = await linesOf()
    expect(before.length).toBeGreaterThan(0)
    await dispatch('POST', '/api/product-lines', { code: 'NOVA', priority: 99 })
    const line = (await linesOf()).find((l) => l.code === 'NOVA')
    expect(line).toBeDefined()
    await dispatch('POST', '/api/product-lines/products', { name: 'Produto X', product_line_id: line!.id })
    const product = (await linesOf()).find((l) => l.id === line!.id)!.products[0]
    expect(product.name).toBe('Produto X')
    await dispatch('POST', '/api/product-lines/links', {
      line_product_id: product.id, platform: 'shopify', integration_id: 'shop-es', external_product_id: 'p-1', title: 'Cojín',
    })
    expect((await linesOf()).find((l) => l.id === line!.id)!.products[0].links).toHaveLength(1)
    await dispatch('DELETE', `/api/product-lines/${line!.id}`, undefined)
    expect((await linesOf()).some((l) => l.id === line!.id)).toBe(false)
  })

  it('a conta oficial tem templates aprovados e a galeria tem imagens', async () => {
    const templates = (await dispatch('GET', `/api/whatsapp-cloud/templates?instance=${DEMO_INSTANCE_PT}`, undefined)).json.templates as unknown[]
    expect(templates.length).toBeGreaterThan(0)
    const media = (await dispatch('GET', `/api/flow-media?instance=${DEMO_INSTANCE_ES}`, undefined)).json.data as unknown[]
    expect(media.length).toBeGreaterThan(0)
  })
})

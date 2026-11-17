import type {
  AutomationInput,
  AutomationStep,
  AutomationStepInput,
  AutomationWithSteps,
  CatalogPlatform,
  ProductCatalogLink,
  ProductLineWithProducts,
} from '@/types'
import { nowIso } from '../clock'
import { bodyOf, fail, ok, route } from '../router'
import { nextId, type DemoStore } from '../store'

function buildSteps(store: DemoStore, automationId: string, inputs: AutomationStepInput[]): AutomationStep[] {
  const timestamp = nowIso()
  return inputs.map((input, position) => ({
    id: nextId(store, 'step'),
    automation_id: automationId,
    position,
    delay_minutes: Number(input.delay_minutes) || 0,
    message: String(input.message ?? ''),
    fallback_template_id: input.fallback_template_id ?? null,
    fallback_template_variable_map: input.fallback_template_variable_map ?? {},
    flow_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  }))
}

function readInput(body: Record<string, unknown>): AutomationInput | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return null
  if (typeof body.kind !== 'string' || typeof body.instance_name !== 'string') return null
  if (!Array.isArray(body.steps) || body.steps.length === 0) return null
  return body as unknown as AutomationInput
}

const findProduct = (lines: ProductLineWithProducts[], productId: string) =>
  lines.flatMap((line) => line.products).find((product) => product.id === productId)

export function registerAutomationHandlers(): void {
  // ── Automações ─────────────────────────────────────────────────────────
  route('GET', '/api/automations', (_req, store) => ok({ automations: store.automations }))

  route('POST', '/api/automations', (req, store) => {
    const input = readInput(bodyOf(req))
    if (!input) return fail('Nome, modelo, conta e pelo menos uma mensagem são obrigatórios')
    const id = nextId(store, 'auto')
    const timestamp = nowIso()
    const automation: AutomationWithSteps = {
      id,
      name: input.name.trim(),
      kind: input.kind,
      platform: input.platform ?? null,
      country: input.country ?? null,
      product_line_id: input.product_line_id ?? null,
      instance_name: input.instance_name,
      enabled: input.enabled !== false,
      config: input.config ?? {},
      created_at: timestamp,
      updated_at: timestamp,
      steps: buildSteps(store, id, input.steps),
    }
    store.automations.push(automation)
    return ok({ automation })
  })

  route('GET', '/api/automations/:id', (req, store) => {
    const automation = store.automations.find((a) => a.id === req.params.id)
    return automation ? ok({ automation }) : fail('Automação não encontrada', 404)
  })

  route('PUT', '/api/automations/:id', (req, store) => {
    const automation = store.automations.find((a) => a.id === req.params.id)
    if (!automation) return fail('Automação não encontrada', 404)
    const input = readInput(bodyOf(req))
    if (!input) return fail('Nome, modelo, conta e pelo menos uma mensagem são obrigatórios')
    Object.assign(automation, {
      name: input.name.trim(),
      kind: input.kind,
      platform: input.platform ?? null,
      country: input.country ?? null,
      product_line_id: input.product_line_id ?? null,
      instance_name: input.instance_name,
      enabled: input.enabled !== false,
      config: input.config ?? {},
      updated_at: nowIso(),
      steps: buildSteps(store, automation.id, input.steps),
    })
    return ok({ automation })
  })

  route('PATCH', '/api/automations/:id', (req, store) => {
    const automation = store.automations.find((a) => a.id === req.params.id)
    if (!automation) return fail('Automação não encontrada', 404)
    const enabled = bodyOf(req).enabled
    if (typeof enabled !== 'boolean') return fail('enabled deve ser booleano')
    automation.enabled = enabled
    automation.updated_at = nowIso()
    return ok({ automation })
  })

  route('DELETE', '/api/automations/:id', (req, store) => {
    store.automations = store.automations.filter((a) => a.id !== req.params.id)
    return ok()
  })

  // ── Linhas de produto ──────────────────────────────────────────────────
  route('GET', '/api/product-lines', (_req, store) =>
    ok({ lines: [...store.productLines].sort((a, b) => a.priority - b.priority) }))

  route('POST', '/api/product-lines', (req, store) => {
    const body = bodyOf(req)
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!code) return fail('Código da linha é obrigatório')
    if (store.productLines.some((line) => line.code === code)) return fail('Já existe uma linha com esse código', 409)
    const timestamp = nowIso()
    const line: ProductLineWithProducts = {
      id: nextId(store, 'line'),
      code,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : code,
      priority: Number(body.priority) || store.productLines.length + 1,
      created_at: timestamp,
      updated_at: timestamp,
      products: [],
    }
    store.productLines.push(line)
    return ok({ line })
  })

  route('PUT', '/api/product-lines/:id', (req, store) => {
    const line = store.productLines.find((l) => l.id === req.params.id)
    if (!line) return fail('Linha não encontrada', 404)
    const body = bodyOf(req)
    if (body.priority !== undefined && Number.isFinite(Number(body.priority))) line.priority = Number(body.priority)
    if (typeof body.name === 'string' && body.name.trim()) line.name = body.name.trim()
    line.updated_at = nowIso()
    return ok({ line })
  })

  route('DELETE', '/api/product-lines/:id', (req, store) => {
    store.productLines = store.productLines.filter((l) => l.id !== req.params.id)
    return ok()
  })

  route('POST', '/api/product-lines/products', (req, store) => {
    const body = bodyOf(req)
    const line = store.productLines.find((l) => l.id === body.product_line_id)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!line || !name) return fail('Linha e nome do produto são obrigatórios')
    const timestamp = nowIso()
    const product = { id: nextId(store, 'lp'), product_line_id: line.id, name, created_at: timestamp, updated_at: timestamp, links: [] }
    line.products.push(product)
    return ok({ product })
  })

  route('PUT', '/api/product-lines/products/:id', (req, store) => {
    const product = findProduct(store.productLines, req.params.id)
    if (!product) return fail('Produto não encontrado', 404)
    const name = bodyOf(req).name
    if (typeof name === 'string' && name.trim()) product.name = name.trim()
    product.updated_at = nowIso()
    return ok({ product })
  })

  route('DELETE', '/api/product-lines/products/:id', (req, store) => {
    for (const line of store.productLines) {
      for (const product of line.products) {
        if (product.id === req.params.id) unlinkCatalog(store, product.links)
      }
      line.products = line.products.filter((p) => p.id !== req.params.id)
    }
    return ok()
  })

  route('POST', '/api/product-lines/links', (req, store) => {
    const body = bodyOf(req)
    const product = findProduct(store.productLines, String(body.line_product_id ?? ''))
    const platform = body.platform
    if (!product || (platform !== 'shopify' && platform !== 'lightfunnels')) return fail('Produto e plataforma são obrigatórios')
    const link: ProductCatalogLink = {
      id: nextId(store, 'link'),
      line_product_id: product.id,
      platform: platform as CatalogPlatform,
      integration_id: String(body.integration_id ?? ''),
      external_product_id: String(body.external_product_id ?? ''),
      title: String(body.title ?? '').slice(0, 300),
      created_at: nowIso(),
    }
    product.links.push(link)
    const option = store.catalog.find((c) => c.platform === link.platform && c.integration_id === link.integration_id && c.external_product_id === link.external_product_id)
    if (option) option.linked_line_product_id = product.id
    return ok({ link })
  })

  route('DELETE', '/api/product-lines/links/:id', (req, store) => {
    for (const product of store.productLines.flatMap((line) => line.products)) {
      unlinkCatalog(store, product.links.filter((l) => l.id === req.params.id))
      product.links = product.links.filter((l) => l.id !== req.params.id)
    }
    return ok()
  })

  route('GET', '/api/product-lines/catalog', (_req, store) => ok({ products: store.catalog }))
}

function unlinkCatalog(store: DemoStore, links: ProductCatalogLink[]): void {
  for (const link of links) {
    const option = store.catalog.find((c) => c.platform === link.platform && c.integration_id === link.integration_id && c.external_product_id === link.external_product_id)
    if (option) option.linked_line_product_id = null
  }
}

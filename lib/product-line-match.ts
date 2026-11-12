// Regras puras de linha de produto (sem banco) — usadas pela lib de servidor,
// pelas rotas e pela UI (sugestão de vínculo pelo título).

import type { LineProduct, ProductCatalogLink, ProductLine } from '@/types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// IDs de produto (não de variante) dos itens de um carrinho/rascunho/pedido
// Shopify, sem repetição. É o mesmo ID guardado em
// product_catalog_links.external_product_id.
export function extractShopifyProductIds(payload: unknown): string[] {
  const items = asRecord(payload).line_items
  if (!Array.isArray(items)) return []
  const ids = new Set<string>()
  for (const item of items) {
    const raw = asRecord(item).product_id
    if (raw === null || raw === undefined || raw === '') continue
    ids.add(String(raw))
  }
  return [...ids]
}

// Produtos Lightfunnels de um pedido gravado (fulfillment_orders.items):
// cada item guarda o produto do funil em lightfunnels_product_id.
export function extractLightfunnelsOrderProductIds(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  const ids = new Set<string>()
  for (const item of items) {
    const raw = asRecord(item).lightfunnels_product_id
    if (typeof raw === 'string' && raw) ids.add(raw)
  }
  return [...ids]
}

// Linha de um conjunto de produtos: a de menor `priority` entre as linhas dos
// produtos vinculados; empate pelo código. Nenhum produto vinculado → null.
export function pickProductLine(
  productIds: string[],
  links: Pick<ProductCatalogLink, 'external_product_id' | 'line_product_id'>[],
  products: Pick<LineProduct, 'id' | 'product_line_id'>[],
  lines: ProductLine[]
): ProductLine | null {
  const wanted = new Set(productIds)
  const lineByProduct = new Map(products.map((product) => [product.id, product.product_line_id]))
  const lineById = new Map(lines.map((line) => [line.id, line]))
  let best: ProductLine | null = null
  for (const link of links) {
    if (!wanted.has(link.external_product_id)) continue
    const lineId = lineByProduct.get(link.line_product_id)
    const line = lineId ? lineById.get(lineId) : undefined
    if (!line) continue
    if (!best || line.priority < best.priority || (line.priority === best.priority && line.code < best.code)) {
      best = line
    }
  }
  return best
}

export function normalizeMatchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

// Sugestão de vínculo: o produto de linha cujo nome aparece como palavra(s)
// inteira(s) no título do catálogo ("Lipogan® 3 frascos" → LIPOGAN). Com mais
// de um candidato, vence o nome mais longo ("VISTA PLUS" antes de "VISTA").
export function suggestLineProduct<T extends Pick<LineProduct, 'id' | 'name'>>(
  catalogTitle: string,
  products: T[]
): T | null {
  const title = ` ${normalizeMatchText(catalogTitle)} `
  let best: T | null = null
  let bestLength = 0
  for (const product of products) {
    const name = normalizeMatchText(product.name)
    if (!name) continue
    if (title.includes(` ${name} `) && name.length > bestLength) {
      best = product
      bestLength = name.length
    }
  }
  return best
}

export const PRODUCT_LINE_CODE_MAX = 20
export const PRODUCT_NAME_MAX = 80

export function parseProductLineInput(body: Record<string, unknown>, partial = false):
  { patch: { code?: string; name?: string; priority?: number } } | { error: string } {
  const patch: { code?: string; name?: string; priority?: number } = {}
  if (!partial || body.code !== undefined) {
    const code = String(body.code ?? '').trim().toUpperCase()
    if (!code) return { error: 'Código da linha obrigatório' }
    if (code.length > PRODUCT_LINE_CODE_MAX) return { error: `Código com no máximo ${PRODUCT_LINE_CODE_MAX} caracteres` }
    patch.code = code
  }
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? patch.code ?? '').trim()
    if (!name) return { error: 'Nome da linha obrigatório' }
    if (name.length > PRODUCT_NAME_MAX) return { error: `Nome com no máximo ${PRODUCT_NAME_MAX} caracteres` }
    patch.name = name
  }
  if (body.priority !== undefined) {
    const priority = Number(body.priority)
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) return { error: 'Prioridade inválida' }
    patch.priority = priority
  } else if (!partial) {
    patch.priority = 100
  }
  return { patch }
}

export function parseLineProductInput(body: Record<string, unknown>, partial = false):
  { patch: { name?: string; product_line_id?: string } } | { error: string } {
  const patch: { name?: string; product_line_id?: string } = {}
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim().toUpperCase()
    if (!name) return { error: 'Nome do produto obrigatório' }
    if (name.length > PRODUCT_NAME_MAX) return { error: `Nome com no máximo ${PRODUCT_NAME_MAX} caracteres` }
    patch.name = name
  }
  if (!partial || body.product_line_id !== undefined) {
    const lineId = String(body.product_line_id ?? '').trim()
    if (!lineId) return { error: 'Linha do produto obrigatória' }
    patch.product_line_id = lineId
  }
  return { patch }
}

// Postgres unique_violation — nome/código repetido.
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

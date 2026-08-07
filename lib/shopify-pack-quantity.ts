export const MAX_UNITS_PER_PACK = 1000

export type PackQuantitySource = 'sku' | 'catalog' | 'title' | 'default'

export interface PackQuantityResolution {
  sku: string
  unitsPerPack: number
  source: PackQuantitySource
}

export interface PackAwareOrderItem {
  product_id: string
  shopify_product_id?: string
  shopify_variant_id?: string
  shopify_quantity?: number
  units_per_pack?: number
  pack_quantity_source?: PackQuantitySource
  sku: string
  name: string
  quantity: number
  unit_price: number
  total: number
}

export interface OrderItemPackBreakdown {
  packQuantity: number
  unitsPerPack: number
  physicalQuantity: number
  manuallyAdjusted: boolean
}

const SKU_PACK_SUFFIX = /^(.*),\s*([1-9]\d{0,3})\s*$/
const PACK_TITLE_PATTERN = /(?:^|[\s(\-/])(\d{1,4})\s*(?:frascos?|botes?|flacones?|flaconi|üvegek?|flacoane?|butelk(?:a|i|ę|ach|ami)?|butelek|bottles?|jars?|flacons?|flaschen?|flessen|unidades?|units?|unità|sztuk(?:a|i)?|bucăți)(?=$|[\s),/+\-])/iu

function validUnits(value: unknown): number | null {
  const units = Number(value)
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS_PER_PACK) return null
  return units
}

function positiveInteger(value: unknown): number | null {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) return null
  return quantity
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function parsePackSku(rawSku: unknown): { sku: string; unitsPerPack: number | null } {
  const original = String(rawSku ?? '').trim()
  const match = original.match(SKU_PACK_SUFFIX)
  if (!match) return { sku: original, unitsPerPack: null }

  const sku = match[1].trim()
  const unitsPerPack = validUnits(match[2])
  if (!sku || !unitsPerPack) return { sku: original, unitsPerPack: null }
  return { sku, unitsPerPack }
}

export function parsePackUnitsFromTitle(...titles: unknown[]): number | null {
  for (const value of titles) {
    const title = String(value ?? '').trim()
    if (!title) continue
    const units = validUnits(title.match(PACK_TITLE_PATTERN)?.[1])
    if (units) return units
  }
  return null
}

export function calculatePhysicalUnitPrice(lineTotal: number, physicalQuantity: number): number {
  if (!Number.isFinite(lineTotal) || !Number.isFinite(physicalQuantity) || physicalQuantity <= 0) return 0
  const precision = 1_000_000
  return Math.round((lineTotal / physicalQuantity + Number.EPSILON) * precision) / precision
}

export function resolvePackQuantity(input: {
  rawSku: unknown
  configuredUnits?: unknown
  titles?: unknown[]
}): PackQuantityResolution {
  const parsedSku = parsePackSku(input.rawSku)
  if (parsedSku.unitsPerPack) {
    return { sku: parsedSku.sku, unitsPerPack: parsedSku.unitsPerPack, source: 'sku' }
  }

  const configuredUnits = validUnits(input.configuredUnits)
  if (configuredUnits) {
    return { sku: parsedSku.sku, unitsPerPack: configuredUnits, source: 'catalog' }
  }

  const titleUnits = parsePackUnitsFromTitle(...(input.titles ?? []))
  if (titleUnits && titleUnits > 1) {
    return { sku: parsedSku.sku, unitsPerPack: titleUnits, source: 'title' }
  }

  return { sku: parsedSku.sku, unitsPerPack: 1, source: 'default' }
}

function findRawLineItem(item: PackAwareOrderItem, rawItems: Record<string, unknown>[], index: number) {
  return rawItems.find((candidate) => {
    const variantId = String(candidate.variant_id ?? '')
    const productId = String(candidate.product_id ?? '')
    return Boolean(
      (item.shopify_variant_id && variantId === item.shopify_variant_id) ||
      (item.shopify_product_id && productId === item.shopify_product_id) ||
      item.product_id === variantId ||
      item.product_id === productId
    )
  }) ?? rawItems[index] ?? {}
}

export function normalizeOrderItemsForPackDisplay<T extends PackAwareOrderItem>(
  items: T[],
  rawLineItems: unknown,
): T[] {
  const rawItems = Array.isArray(rawLineItems) ? rawLineItems.map(asRecord) : []

  return items.map((item, index) => {
    const rawItem = findRawLineItem(item, rawItems, index)
    const storedUnits = validUnits(item.units_per_pack)
    const rawShopifyQuantity = positiveInteger(rawItem.current_quantity ?? rawItem.quantity)
    const storedShopifyQuantity = positiveInteger(item.shopify_quantity)
    const pack = resolvePackQuantity({
      rawSku: rawItem.sku || item.sku,
      configuredUnits: storedUnits ?? undefined,
      titles: [rawItem.variant_title, rawItem.name, rawItem.title, item.name],
    })

    if (pack.unitsPerPack <= 1) {
      return { ...item, sku: pack.sku || item.sku }
    }

    const packQuantity = storedShopifyQuantity ?? rawShopifyQuantity ?? positiveInteger(item.quantity) ?? 1
    const expandsLegacyQuantity = storedUnits === null && (
      rawShopifyQuantity === null || item.quantity === rawShopifyQuantity
    )
    const physicalQuantity = expandsLegacyQuantity
      ? packQuantity * pack.unitsPerPack
      : item.quantity

    return {
      ...item,
      sku: pack.sku || item.sku,
      shopify_quantity: packQuantity,
      units_per_pack: pack.unitsPerPack,
      pack_quantity_source: item.pack_quantity_source ?? pack.source,
      quantity: physicalQuantity,
      unit_price: expandsLegacyQuantity
        ? calculatePhysicalUnitPrice(item.total, physicalQuantity)
        : item.unit_price,
    }
  })
}

export function getOrderItemPackBreakdown(item: PackAwareOrderItem): OrderItemPackBreakdown | null {
  const unitsPerPack = validUnits(item.units_per_pack)
  const packQuantity = positiveInteger(item.shopify_quantity)
  if (!unitsPerPack || unitsPerPack <= 1 || !packQuantity) return null
  const expectedQuantity = packQuantity * unitsPerPack
  return {
    packQuantity,
    unitsPerPack,
    physicalQuantity: item.quantity,
    manuallyAdjusted: item.quantity !== expectedQuantity,
  }
}

export function formatOrderItemPackBreakdown(item: PackAwareOrderItem): string | null {
  const breakdown = getOrderItemPackBreakdown(item)
  if (!breakdown) return null
  if (breakdown.manuallyAdjusted) {
    return `${breakdown.physicalQuantity} unidades físicas (pacote original: ${breakdown.packQuantity} × ${breakdown.unitsPerPack} un.)`
  }
  const packLabel = breakdown.packQuantity === 1 ? 'pacote' : 'pacotes'
  return `${breakdown.packQuantity} ${packLabel} × ${breakdown.unitsPerPack} un. = ${breakdown.physicalQuantity} unidades físicas`
}

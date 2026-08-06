export const MAX_UNITS_PER_PACK = 1000

export type PackQuantitySource = 'sku' | 'catalog' | 'title' | 'default'

export interface PackQuantityResolution {
  sku: string
  unitsPerPack: number
  source: PackQuantitySource
}

const SKU_PACK_SUFFIX = /^(.*),\s*([1-9]\d{0,3})\s*$/
const PACK_TITLE_PATTERN = /(?:^|[\s(\-/])(\d{1,4})\s*(?:frascos?|botes?|flacones?|flaconi|üvegek?|flacoane?|butelk(?:a|i|ę|ach|ami)?|butelek|bottles?|jars?|flacons?|flaschen?|flessen|unidades?|units?|unità|sztuk(?:a|i)?|bucăți)(?=$|[\s),/+\-])/iu

function validUnits(value: unknown): number | null {
  const units = Number(value)
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS_PER_PACK) return null
  return units
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

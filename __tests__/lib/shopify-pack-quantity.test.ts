import {
  calculatePhysicalUnitPrice,
  parsePackSku,
  parsePackUnitsFromTitle,
  resolvePackQuantity,
} from '@/lib/shopify-pack-quantity'

describe('Shopify pack quantity', () => {
  it('extracts the pack size from a trailing SKU suffix', () => {
    expect(parsePackSku('-DS-6228,3')).toEqual({ sku: '-DS-6228', unitsPerPack: 3 })
  })

  it('does not strip invalid or non-numeric SKU suffixes', () => {
    expect(parsePackSku('ABC,0')).toEqual({ sku: 'ABC,0', unitsPerPack: null })
    expect(parsePackSku('ABC,BLUE')).toEqual({ sku: 'ABC,BLUE', unitsPerPack: null })
  })

  it('recognizes supported multilingual package titles', () => {
    expect(parsePackUnitsFromTitle('3 Frascos de Lipogan (37% OFF)')).toBe(3)
    expect(parsePackUnitsFromTitle('6 flaconi')).toBe(6)
    expect(parsePackUnitsFromTitle('2 butelki')).toBe(2)
  })

  it('prefers the SKU suffix over catalog and title fallbacks', () => {
    expect(resolvePackQuantity({
      rawSku: 'PACK,3',
      configuredUnits: 4,
      titles: ['6 Frascos'],
    })).toEqual({ sku: 'PACK', unitsPerPack: 3, source: 'sku' })
  })

  it('uses catalog configuration before the title fallback', () => {
    expect(resolvePackQuantity({
      rawSku: 'PACK',
      configuredUnits: 4,
      titles: ['6 Frascos'],
    })).toEqual({ sku: 'PACK', unitsPerPack: 4, source: 'catalog' })
  })

  it('keeps enough precision for indivisible pack totals', () => {
    expect(calculatePhysicalUnitPrice(100, 3)).toBe(33.333333)
    expect(calculatePhysicalUnitPrice(99.9, 3)).toBe(33.3)
  })
})

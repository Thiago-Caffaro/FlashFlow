import {
  calculatePhysicalUnitPrice,
  formatOrderItemPackBreakdown,
  normalizeOrderItemsForPackDisplay,
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

  it('reconstructs physical units for an order saved before pack metadata existed', () => {
    const [item] = normalizeOrderItemsForPackDisplay([{
      product_id: '200',
      shopify_product_id: '100',
      shopify_variant_id: '200',
      sku: '-FD-9545,3',
      name: 'LIPOGAN F1 - 3 Frascos de Lipogan (37% OFF)',
      quantity: 1,
      unit_price: 99.9,
      total: 99.9,
    }], [{
      product_id: 100,
      variant_id: 200,
      sku: '-FD-9545,3',
      quantity: 1,
    }])

    expect(item).toMatchObject({
      sku: '-FD-9545',
      shopify_quantity: 1,
      units_per_pack: 3,
      pack_quantity_source: 'sku',
      quantity: 3,
      unit_price: 33.3,
      total: 99.9,
    })
    expect(formatOrderItemPackBreakdown(item)).toBe('1 pacote × 3 un. = 3 unidades físicas')
  })

  it('does not multiply an item that already stores its physical pack quantity', () => {
    const [item] = normalizeOrderItemsForPackDisplay([{
      product_id: '200',
      shopify_quantity: 1,
      units_per_pack: 3,
      pack_quantity_source: 'sku' as const,
      sku: '-FD-9545',
      name: 'LIPOGAN F1',
      quantity: 3,
      unit_price: 33.3,
      total: 99.9,
    }], [{ sku: '-FD-9545,3', quantity: 1 }])

    expect(item.quantity).toBe(3)
    expect(item.total).toBe(99.9)
  })

  it('uses the product title as a display fallback for legacy orders', () => {
    const [item] = normalizeOrderItemsForPackDisplay([{
      product_id: '200',
      sku: '-FD-9545',
      name: 'LIPOGAN T4 - 6 Frascos de Lipogan (52% OFF)',
      quantity: 1,
      unit_price: 149.9,
      total: 149.9,
    }], [])

    expect(item).toMatchObject({
      shopify_quantity: 1,
      units_per_pack: 6,
      pack_quantity_source: 'title',
      quantity: 6,
    })
  })
})

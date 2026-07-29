import {
  filterShopifyProducts,
  paginateShopifyProducts,
} from '@/lib/shopify-product-catalog'
import type { ShopifyProduct } from '@/types'

function product(overrides: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    id: 'product-1',
    shopify_integration_id: 'integration-1',
    shopify_product_id: 'shopify-product-1',
    shopify_variant_id: 'variant-1',
    sku: 'SKU-1',
    title: 'Produto',
    variant_title: null,
    price: 10,
    currency: 'EUR',
    image_url: null,
    source: 'shopify',
    hidden: false,
    keep_local_copy: false,
    local_product_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('shopify product catalog', () => {
  const products = [
    product({ id: '1', title: 'Café premium', sku: 'CAF-01', keep_local_copy: true }),
    product({ id: '2', title: 'Chá verde', variant_title: 'Caixa grande', sku: 'CHA-02' }),
    product({ id: '3', title: 'Produto manual', source: 'manual', shopify_integration_id: null }),
  ]

  it('busca por nome, variante ou SKU sem diferenciar acentos e maiúsculas', () => {
    expect(filterShopifyProducts(products, { search: 'cafe', source: 'all', copy: 'all' }).map((item) => item.id)).toEqual(['1'])
    expect(filterShopifyProducts(products, { search: 'CAIXA GRANDE', source: 'all', copy: 'all' }).map((item) => item.id)).toEqual(['2'])
    expect(filterShopifyProducts(products, { search: 'cha-02', source: 'all', copy: 'all' }).map((item) => item.id)).toEqual(['2'])
  })

  it('combina os filtros de origem e cópia local', () => {
    expect(filterShopifyProducts(products, { search: '', source: 'shopify', copy: 'local' }).map((item) => item.id)).toEqual(['1'])
    expect(filterShopifyProducts(products, { search: '', source: 'manual', copy: 'not-local' }).map((item) => item.id)).toEqual(['3'])
  })

  it('pagina e corrige páginas fora do intervalo', () => {
    const manyProducts = Array.from({ length: 95 }, (_, index) => product({ id: String(index + 1) }))

    expect(paginateShopifyProducts(manyProducts, 2, 40).products).toHaveLength(40)
    expect(paginateShopifyProducts(manyProducts, 99, 40)).toMatchObject({
      page: 3,
      totalPages: 3,
    })
    expect(paginateShopifyProducts([], 1, 40)).toEqual({
      page: 1,
      totalPages: 1,
      products: [],
    })
  })
})

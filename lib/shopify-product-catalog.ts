import type { ShopifyProduct } from '@/types'

export type ShopifyProductSourceFilter = 'all' | ShopifyProduct['source']
export type ShopifyProductCopyFilter = 'all' | 'local' | 'not-local'

interface ShopifyProductFilters {
  search: string
  source: ShopifyProductSourceFilter
  copy: ShopifyProductCopyFilter
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

export function filterShopifyProducts(
  products: ShopifyProduct[],
  filters: ShopifyProductFilters,
): ShopifyProduct[] {
  const search = normalizeSearch(filters.search)

  return products.filter((product) => {
    if (filters.source !== 'all' && product.source !== filters.source) return false
    if (filters.copy === 'local' && !product.keep_local_copy) return false
    if (filters.copy === 'not-local' && product.keep_local_copy) return false
    if (!search) return true

    const searchable = normalizeSearch([
      product.title,
      product.variant_title,
      product.sku,
    ].filter(Boolean).join(' '))

    return searchable.includes(search)
  })
}

export function paginateShopifyProducts(
  products: ShopifyProduct[],
  page: number,
  pageSize: number,
): { page: number; totalPages: number; products: ShopifyProduct[] } {
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize

  return {
    page: safePage,
    totalPages,
    products: products.slice(start, start + pageSize),
  }
}

import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { extractShopifyProductIds, pickProductLine } from './product-line-match'
import type {
  CatalogPlatform,
  CatalogProductOption,
  LineProduct,
  ProductCatalogLink,
  ProductLine,
  ProductLineWithProducts,
} from '@/types'

async function loadAll(): Promise<{ lines: ProductLine[]; products: LineProduct[]; links: ProductCatalogLink[] }> {
  const [lines, products, links] = await Promise.all([
    supabaseAdmin.from('product_lines').select('*').order('priority').order('code'),
    supabaseAdmin.from('line_products').select('*').order('name'),
    supabaseAdmin.from('product_catalog_links').select('*').order('created_at'),
  ])
  if (lines.error) throw new Error(`Falha ao consultar linhas de produto: ${lines.error.message}`)
  if (products.error) throw new Error(`Falha ao consultar produtos de linha: ${products.error.message}`)
  if (links.error) throw new Error(`Falha ao consultar vínculos de catálogo: ${links.error.message}`)
  return {
    lines: (lines.data ?? []) as ProductLine[],
    products: (products.data ?? []) as LineProduct[],
    links: (links.data ?? []) as ProductCatalogLink[],
  }
}

export async function listProductLinesWithProducts(): Promise<ProductLineWithProducts[]> {
  const { lines, products, links } = await loadAll()
  return lines.map((line) => ({
    ...line,
    products: products
      .filter((product) => product.product_line_id === line.id)
      .map((product) => ({
        ...product,
        links: links.filter((link) => link.line_product_id === product.id),
      })),
  }))
}

type ShopifyCatalogRow = {
  shopify_integration_id: string | null
  shopify_product_id: string | null
  title: string
  image_url: string | null
}

type LightfunnelsCatalogRow = {
  lightfunnels_integration_id: string | null
  lf_product_id: string | null
  title: string
  image_url: string | null
}

// Catálogo de todas as lojas agrupado por produto (as variantes viram uma
// linha só), marcando a qual produto de linha cada um já está vinculado.
export async function listCatalogProductOptions(): Promise<CatalogProductOption[]> {
  const [shopifyProducts, shopifyIntegrations, lfProducts, lfIntegrations, links] = await Promise.all([
    supabaseAdmin.from('shopify_products').select('shopify_integration_id, shopify_product_id, title, image_url').order('title'),
    supabaseAdmin.from('shopify_integrations').select('id, shop_name, shop_domain, default_country'),
    supabaseAdmin.from('lightfunnels_products').select('lightfunnels_integration_id, lf_product_id, title, image_url').order('title'),
    supabaseAdmin.from('lightfunnels_integrations').select('id, name'),
    supabaseAdmin.from('product_catalog_links').select('platform, integration_id, external_product_id, line_product_id'),
  ])
  for (const result of [shopifyProducts, shopifyIntegrations, lfProducts, lfIntegrations, links]) {
    if (result.error) throw new Error(`Falha ao consultar catálogo: ${result.error.message}`)
  }

  const linkKey = (platform: CatalogPlatform, integrationId: string, productId: string) =>
    `${platform}:${integrationId}:${productId}`
  const linked = new Map<string, string>()
  for (const link of (links.data ?? []) as Pick<ProductCatalogLink, 'platform' | 'integration_id' | 'external_product_id' | 'line_product_id'>[]) {
    linked.set(linkKey(link.platform, link.integration_id, link.external_product_id), link.line_product_id)
  }

  const shopifyLabels = new Map<string, string>()
  for (const row of (shopifyIntegrations.data ?? []) as Array<{ id: string; shop_name: string | null; shop_domain: string; default_country: string | null }>) {
    const name = row.shop_name || row.shop_domain
    shopifyLabels.set(row.id, row.default_country ? `${name} (${row.default_country})` : name)
  }
  const lfLabels = new Map<string, string>()
  for (const row of (lfIntegrations.data ?? []) as Array<{ id: string; name: string }>) {
    lfLabels.set(row.id, row.name)
  }

  const options = new Map<string, CatalogProductOption>()
  for (const row of (shopifyProducts.data ?? []) as ShopifyCatalogRow[]) {
    if (!row.shopify_integration_id || !row.shopify_product_id) continue
    const key = linkKey('shopify', row.shopify_integration_id, row.shopify_product_id)
    if (options.has(key)) continue
    options.set(key, {
      platform: 'shopify',
      integration_id: row.shopify_integration_id,
      store_label: shopifyLabels.get(row.shopify_integration_id) ?? 'Loja Shopify',
      external_product_id: row.shopify_product_id,
      title: row.title,
      image_url: row.image_url,
      linked_line_product_id: linked.get(key) ?? null,
    })
  }
  for (const row of (lfProducts.data ?? []) as LightfunnelsCatalogRow[]) {
    if (!row.lightfunnels_integration_id || !row.lf_product_id) continue
    const key = linkKey('lightfunnels', row.lightfunnels_integration_id, row.lf_product_id)
    if (options.has(key)) continue
    options.set(key, {
      platform: 'lightfunnels',
      integration_id: row.lightfunnels_integration_id,
      store_label: lfLabels.get(row.lightfunnels_integration_id) ?? 'Lightfunnels',
      external_product_id: row.lf_product_id,
      title: row.title,
      image_url: row.image_url,
      linked_line_product_id: linked.get(key) ?? null,
    })
  }
  return [...options.values()]
}

// Linha de um carrinho/rascunho Shopify pelos produtos vinculados da loja.
// null quando nenhum produto do carrinho está vinculado.
export async function resolveShopifyCartProductLine(
  integrationId: string,
  payload: unknown
): Promise<ProductLine | null> {
  const productIds = extractShopifyProductIds(payload)
  if (productIds.length === 0) return null

  const { data: links, error } = await supabaseAdmin
    .from('product_catalog_links')
    .select('external_product_id, line_product_id')
    .eq('platform', 'shopify')
    .eq('integration_id', integrationId)
    .in('external_product_id', productIds)
  if (error) throw new Error(`Falha ao consultar vínculos de catálogo: ${error.message}`)
  if (!links || links.length === 0) return null

  const productIdsLinked = [...new Set(links.map((link) => String(link.line_product_id)))]
  const { data: products, error: productsError } = await supabaseAdmin
    .from('line_products')
    .select('id, product_line_id')
    .in('id', productIdsLinked)
  if (productsError) throw new Error(`Falha ao consultar produtos de linha: ${productsError.message}`)

  const lineIds = [...new Set((products ?? []).map((product) => String(product.product_line_id)))]
  if (lineIds.length === 0) return null
  const { data: lines, error: linesError } = await supabaseAdmin
    .from('product_lines')
    .select('*')
    .in('id', lineIds)
  if (linesError) throw new Error(`Falha ao consultar linhas de produto: ${linesError.message}`)

  return pickProductLine(
    productIds,
    links as Pick<ProductCatalogLink, 'external_product_id' | 'line_product_id'>[],
    (products ?? []) as Pick<LineProduct, 'id' | 'product_line_id'>[],
    (lines ?? []) as ProductLine[]
  )
}

export async function catalogIntegrationExists(platform: CatalogPlatform, integrationId: string): Promise<boolean> {
  const table = platform === 'shopify' ? 'shopify_integrations' : 'lightfunnels_integrations'
  const { data, error } = await supabaseAdmin.from(table).select('id').eq('id', integrationId).maybeSingle()
  if (error) throw new Error(`Falha ao consultar integração: ${error.message}`)
  return Boolean(data)
}

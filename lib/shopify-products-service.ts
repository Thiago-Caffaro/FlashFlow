import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import {
  listActiveShopifyIntegrations,
  shopifyClientFromIntegration,
  type ShopifyIntegrationCredentialRow,
} from './shopify-integration-store'
import type { ShopifyProduct } from '@/types'

interface RawShopifyVariant {
  id: number | string
  sku?: string | null
  price?: string | number | null
  title?: string | null
}

interface RawShopifyProduct {
  id: number | string
  title: string
  image?: { src?: string | null } | null
  images?: Array<{ src?: string | null }>
  variants?: RawShopifyVariant[]
}

type ShopifyProductRow = Pick<ShopifyProduct, 'id' | 'keep_local_copy' | 'local_product_id'>

async function resolveFallbackCurrency(integrationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('currency')
    .eq('shopify_integration_id', integrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.currency as string | undefined) ?? 'EUR'
}

async function resolveIntegrationCountry(integrationId: string | null): Promise<string> {
  if (!integrationId) return 'DESCONHECIDO'
  const { data } = await supabaseAdmin
    .from('shopify_integrations')
    .select('default_country')
    .eq('id', integrationId)
    .maybeSingle()
  return (data?.default_country as string | undefined) ?? 'DESCONHECIDO'
}

// Propagates the current sku/name/price/currency of a synced Shopify product
// into its linked fulfillment_products row (creating the mirror on first
// enable). Never touches shopify_products.hidden/keep_local_copy — those are
// only ever written explicitly via setKeepLocalCopy/hideShopifyProduct.
export async function mirrorToFulfillmentProduct(shopifyProductId: string): Promise<void> {
  const { data: row, error } = await supabaseAdmin
    .from('shopify_products')
    .select('id, shopify_integration_id, sku, title, variant_title, price, currency, local_product_id')
    .eq('id', shopifyProductId)
    .single()
  if (error || !row) {
    throw new Error(`Falha ao carregar produto Shopify para cópia local: ${error?.message ?? 'produto não encontrado'}`)
  }

  const name = row.variant_title ? `${row.title} — ${row.variant_title}` : row.title
  const sku = row.sku || `SHOPIFY-${shopifyProductId}`
  const country = await resolveIntegrationCountry(row.shopify_integration_id)
  const { data: matchingMirror, error: matchingError } = await supabaseAdmin
    .from('fulfillment_products')
    .select('id')
    .eq('country', country)
    .eq('sku', sku)
    .maybeSingle()
  if (matchingError) throw new Error(`Falha ao localizar cópia local por SKU: ${matchingError.message}`)

  const mirrorId = matchingMirror?.id ?? row.local_product_id
  if (mirrorId) {
    const { error: updateError } = await supabaseAdmin
      .from('fulfillment_products')
      .update({ country, sku, name, price: row.price, currency: row.currency, active: true, updated_at: new Date().toISOString() })
      .eq('id', mirrorId)
    if (updateError) throw new Error(`Falha ao atualizar cópia local: ${updateError.message}`)

    const { error: linkError } = await supabaseAdmin
      .from('shopify_products')
      .update({ local_product_id: mirrorId, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (linkError) throw new Error(`Falha ao vincular cópia local: ${linkError.message}`)
    return
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('fulfillment_products')
    .insert({ country, sku, name, price: row.price, currency: row.currency, active: true })
    .select('id')
    .single()
  if (createError || !created) {
    throw new Error(`Falha ao criar cópia local: ${createError?.message ?? 'resposta vazia'}`)
  }

  const { error: linkError } = await supabaseAdmin
    .from('shopify_products')
    .update({ local_product_id: created.id })
    .eq('id', row.id)
  if (linkError) throw new Error(`Falha ao vincular cópia local: ${linkError.message}`)
}

// Turning the toggle on creates/refreshes the mirror immediately; turning it
// off unlinks the mirror without deleting it — it becomes an independent
// fulfillment_products row (may already be referenced by flow nodes).
export async function setKeepLocalCopy(shopifyProductId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await supabaseAdmin
      .from('shopify_products')
      .update({ keep_local_copy: true, updated_at: new Date().toISOString() })
      .eq('id', shopifyProductId)
    await mirrorToFulfillmentProduct(shopifyProductId)
  } else {
    await supabaseAdmin
      .from('shopify_products')
      .update({ keep_local_copy: false, local_product_id: null, updated_at: new Date().toISOString() })
      .eq('id', shopifyProductId)
  }
}

export async function setKeepLocalCopies(shopifyProductIds: string[], enabled: boolean): Promise<number> {
  const ids = [...new Set(shopifyProductIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return 0
  if (ids.length > 1000) throw new Error('No maximo 1000 produtos podem ser alterados por vez')

  const { data, error } = await supabaseAdmin.rpc('set_shopify_products_local_copy', {
    p_ids: ids,
    p_enabled: enabled,
  })
  if (error) throw new Error(`Falha ao atualizar copias locais: ${error.message}`)
  return Number(data ?? 0)
}

// Shopify-sourced rows are never hard-deleted (a resync would just bring them
// back) — hiding also forces the local-copy toggle off, since a hidden
// product shouldn't keep feeding the AI's operational catalog.
export async function hideShopifyProduct(shopifyProductId: string): Promise<void> {
  await supabaseAdmin
    .from('shopify_products')
    .update({
      hidden: true,
      keep_local_copy: false,
      local_product_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shopifyProductId)
}

async function upsertShopifyProductVariant(
  integrationId: string,
  product: RawShopifyProduct,
  variant: RawShopifyVariant,
  imageUrl: string | null,
  currency: string
): Promise<void> {
  const price = Number(variant.price ?? 0)
  const variantTitle = variant.title && variant.title !== 'Default Title' ? variant.title : null

  const { data, error } = await supabaseAdmin
    .from('shopify_products')
    .upsert(
      {
        shopify_integration_id: integrationId,
        shopify_product_id: String(product.id),
        shopify_variant_id: String(variant.id),
        sku: variant.sku || null,
        title: product.title,
        variant_title: variantTitle,
        price: Number.isFinite(price) ? price : 0,
        currency,
        image_url: imageUrl,
        source: 'shopify' as const,
        raw_shopify_payload: { product_id: product.id, variant },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shopify_integration_id,shopify_variant_id' }
    )
    .select('id, keep_local_copy, local_product_id')
    .single()

  if (error || !data) {
    throw new Error(
      `Falha ao sincronizar produto Shopify ${String(product.id)}/${String(variant.id)}: ${error?.message ?? 'resposta vazia'}`
    )
  }
  const row = data as ShopifyProductRow
  if (row.keep_local_copy) await mirrorToFulfillmentProduct(row.id)
}

export async function syncShopifyProductsForIntegration(
  integration: ShopifyIntegrationCredentialRow,
  options: { maxPages?: number } = {}
): Promise<{ imported: number }> {
  const client = shopifyClientFromIntegration(integration)
  const currency = await resolveFallbackCurrency(integration.id)
  const maxPages = options.maxPages ?? 10

  let imported = 0
  let pageInfo: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const { products, nextPageInfo } = await client.getProductsPage({ limit: 100, pageInfo })
    for (const rawProduct of products as RawShopifyProduct[]) {
      const imageUrl = rawProduct.image?.src ?? rawProduct.images?.[0]?.src ?? null
      for (const variant of rawProduct.variants ?? []) {
        await upsertShopifyProductVariant(integration.id, rawProduct, variant, imageUrl, currency)
        imported += 1
      }
    }
    if (!nextPageInfo) break
    pageInfo = nextPageInfo
  }

  return { imported }
}

export async function syncShopifyProductsForAllIntegrations(
  options: { integrationId?: string; maxPages?: number } = {}
): Promise<{ integrations: number; importedProducts: number; errors: Array<{ shopDomain: string; error: string }> }> {
  const integrations = await listActiveShopifyIntegrations(options.integrationId)
  let importedProducts = 0
  const errors: Array<{ shopDomain: string; error: string }> = []

  for (const integration of integrations) {
    try {
      const result = await syncShopifyProductsForIntegration(integration, { maxPages: options.maxPages })
      importedProducts += result.imported
    } catch (error) {
      errors.push({
        shopDomain: integration.shop_domain,
        error: error instanceof Error ? error.message : 'Erro inesperado',
      })
    }
  }

  return { integrations: integrations.length, importedProducts, errors }
}

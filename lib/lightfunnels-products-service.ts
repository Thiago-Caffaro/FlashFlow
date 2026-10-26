import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { resolvePackQuantity } from './shopify-pack-quantity'
import { lightfunnelsClientFor } from './lightfunnels-token'
import type { LightfunnelsIntegrationCredentialRow } from './lightfunnels-integration-store'
import type { LightfunnelsProduct } from '@/types'

// Catálogo Lightfunnels (lightfunnels_products), no mesmo modelo de
// shopify_products: uma linha por variante; `keep_local_copy` mantém um
// espelho em fulfillment_products (catálogo operacional do FenixCOD e da IA).
// O Lightfunnels nunca é alterado por aqui — hidden é só local.

export const LIGHTFUNNELS_PRODUCT_PUBLIC_SELECT =
  'id, lightfunnels_integration_id, lf_product_id, lf_variant_id, sku, title, variant_title, units_per_pack, price, currency, image_url, hidden, keep_local_copy, local_product_id, created_at, updated_at'

interface RawVariant {
  id?: string | number
  title?: string | null
  sku?: string | null
  price?: number | string | null
}

interface RawProduct {
  id?: string | number
  title?: string | null
  sku?: string | null
  price?: number | string | null
  thumbnail?: { path?: string | null } | null
  variants?: RawVariant[] | null
}

async function resolveFallbackCurrency(integrationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('currency')
    .eq('lightfunnels_integration_id', integrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.currency as string | undefined) ?? 'EUR'
}

// Espelha a variante em fulfillment_products (cria na primeira vez; depois
// mantém sku/nome/preço em dia). Reaproveita uma linha local com o mesmo
// país+SKU, como o espelho da Shopify.
export async function mirrorLightfunnelsProduct(productRowId: string): Promise<void> {
  const { data: row, error } = await supabaseAdmin
    .from('lightfunnels_products')
    .select('id, lightfunnels_integration_id, sku, title, variant_title, units_per_pack, price, currency, local_product_id')
    .eq('id', productRowId)
    .single()
  if (error || !row) throw new Error(`Falha ao carregar produto Lightfunnels: ${error?.message ?? 'não encontrado'}`)

  let country = 'DESCONHECIDO'
  if (row.lightfunnels_integration_id) {
    const { data: integration } = await supabaseAdmin
      .from('lightfunnels_integrations')
      .select('default_country')
      .eq('id', row.lightfunnels_integration_id)
      .maybeSingle()
    country = (integration?.default_country as string | undefined) ?? country
  }

  const name = row.variant_title ? `${row.title} — ${row.variant_title}` : row.title
  const sku = row.sku || `LIGHTFUNNELS-${row.id}`
  const fields = {
    country,
    sku,
    name,
    units_per_pack: row.units_per_pack ?? 1,
    price: row.price,
    currency: row.currency,
    active: true,
    updated_at: new Date().toISOString(),
  }

  const { data: matching, error: matchingError } = await supabaseAdmin
    .from('fulfillment_products')
    .select('id')
    .eq('country', country)
    .eq('sku', sku)
    .maybeSingle()
  if (matchingError) throw new Error(`Falha ao localizar cópia local por SKU: ${matchingError.message}`)

  let mirrorId = (matching?.id as string | undefined) ?? (row.local_product_id as string | null) ?? null
  if (mirrorId) {
    const { error: updateError } = await supabaseAdmin.from('fulfillment_products').update(fields).eq('id', mirrorId)
    if (updateError) throw new Error(`Falha ao atualizar cópia local: ${updateError.message}`)
  } else {
    const { data: created, error: createError } = await supabaseAdmin
      .from('fulfillment_products')
      .insert(fields)
      .select('id')
      .single()
    if (createError || !created) throw new Error(`Falha ao criar cópia local: ${createError?.message ?? 'resposta vazia'}`)
    mirrorId = created.id as string
  }

  const { error: linkError } = await supabaseAdmin
    .from('lightfunnels_products')
    .update({ local_product_id: mirrorId, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (linkError) throw new Error(`Falha ao vincular cópia local: ${linkError.message}`)
}

export async function setLightfunnelsKeepLocalCopy(productRowIds: string[], enabled: boolean): Promise<number> {
  const ids = [...new Set(productRowIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return 0
  if (ids.length > 500) throw new Error('No máximo 500 produtos podem ser alterados por vez')

  if (!enabled) {
    const { error } = await supabaseAdmin
      .from('lightfunnels_products')
      .update({ keep_local_copy: false, local_product_id: null, updated_at: new Date().toISOString() })
      .in('id', ids)
    if (error) throw new Error(`Falha ao desligar cópia local: ${error.message}`)
    return ids.length
  }

  const { error } = await supabaseAdmin
    .from('lightfunnels_products')
    .update({ keep_local_copy: true, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('hidden', false)
  if (error) throw new Error(`Falha ao ligar cópia local: ${error.message}`)
  for (const id of ids) await mirrorLightfunnelsProduct(id)
  return ids.length
}

export async function setLightfunnelsProductHidden(productRowId: string, hidden: boolean): Promise<void> {
  const patch: Record<string, unknown> = { hidden, updated_at: new Date().toISOString() }
  // Produto oculto não alimenta mais o catálogo operacional.
  if (hidden) Object.assign(patch, { keep_local_copy: false, local_product_id: null })
  const { error } = await supabaseAdmin.from('lightfunnels_products').update(patch).eq('id', productRowId)
  if (error) throw new Error(`Falha ao atualizar produto: ${error.message}`)
}

async function upsertVariant(
  integrationId: string,
  product: RawProduct,
  variant: RawVariant | null,
  currency: string
): Promise<void> {
  const productId = String(product.id ?? '')
  // Produto sem variantes vira uma linha só, identificada pelo próprio id.
  const variantId = variant?.id !== undefined && variant?.id !== null ? String(variant.id) : productId
  const title = String(product.title ?? '').trim() || 'Produto Lightfunnels'
  const variantTitle = variant?.title && variant.title !== title ? String(variant.title) : null
  const rawSku = variant?.sku || product.sku
  const pack = resolvePackQuantity({ rawSku, titles: [variantTitle, title] })
  const price = Number(variant?.price ?? product.price ?? 0)

  const { data, error } = await supabaseAdmin
    .from('lightfunnels_products')
    .upsert({
      lightfunnels_integration_id: integrationId,
      lf_product_id: productId,
      lf_variant_id: variantId,
      sku: pack.sku || null,
      units_per_pack: pack.unitsPerPack,
      title,
      variant_title: variantTitle,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      currency,
      image_url: product.thumbnail?.path ?? null,
      raw_lightfunnels_payload: { product_id: productId, variant },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lightfunnels_integration_id,lf_variant_id' })
    .select('id, keep_local_copy')
    .single()
  if (error || !data) {
    throw new Error(`Falha ao sincronizar produto Lightfunnels ${productId}/${variantId}: ${error?.message ?? 'resposta vazia'}`)
  }
  if ((data as Pick<LightfunnelsProduct, 'keep_local_copy'>).keep_local_copy) {
    await mirrorLightfunnelsProduct(String(data.id))
  }
}

async function upsertProduct(integrationId: string, product: RawProduct, currency: string): Promise<number> {
  const variants = Array.isArray(product.variants) ? product.variants : []
  if (variants.length === 0) {
    await upsertVariant(integrationId, product, null, currency)
    return 1
  }
  for (const variant of variants) await upsertVariant(integrationId, product, variant, currency)
  return variants.length
}

export async function syncLightfunnelsProductsForIntegration(
  integration: LightfunnelsIntegrationCredentialRow,
  options: { maxPages?: number } = {}
): Promise<{ imported: number }> {
  const client = await lightfunnelsClientFor(integration)
  const currency = await resolveFallbackCurrency(integration.id)
  let imported = 0
  let after: string | null = null
  for (let page = 0; page < (options.maxPages ?? 20); page++) {
    const result = await client.listProductsPage({ first: 50, after })
    for (const product of result.nodes as RawProduct[]) {
      imported += await upsertProduct(integration.id, product, currency)
    }
    if (!result.hasNextPage || !result.endCursor) break
    after = result.endCursor
  }
  return { imported }
}

// Webhook product/created|updated: o payload só traz id/título/descrição,
// então o produto completo (variantes, preço) vem da API.
export async function syncLightfunnelsProductById(
  integration: LightfunnelsIntegrationCredentialRow,
  lfProductId: string
): Promise<void> {
  const client = await lightfunnelsClientFor(integration)
  const product = await client.getProduct(lfProductId)
  if (!product) return
  await upsertProduct(integration.id, product as RawProduct, await resolveFallbackCurrency(integration.id))
}

// product/deleted: oculta localmente (não apaga — a cópia local pode estar
// referenciada por fluxos), igual a um produto Shopify oculto.
export async function deleteLightfunnelsProductByLfId(integrationId: string, lfProductId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('lightfunnels_products')
    .update({ hidden: true, keep_local_copy: false, local_product_id: null, updated_at: new Date().toISOString() })
    .eq('lightfunnels_integration_id', integrationId)
    .eq('lf_product_id', lfProductId)
  if (error) throw new Error(`Falha ao ocultar produto Lightfunnels removido: ${error.message}`)
}

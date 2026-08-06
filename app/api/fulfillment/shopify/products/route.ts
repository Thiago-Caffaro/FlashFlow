import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { MAX_UNITS_PER_PACK, resolvePackQuantity } from '@/lib/shopify-pack-quantity'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hideShopifyProduct, setKeepLocalCopies, setKeepLocalCopy } from '@/lib/shopify-products-service'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseCreatePatch(body: Record<string, unknown>) {
  const title = String(body.title ?? '').trim()
  if (!title) return { error: 'Nome obrigatório' }
  const price = Number(body.price)
  if (!Number.isFinite(price) || price < 0) return { error: 'Preço inválido' }
  const requestedUnits = Number(body.units_per_pack ?? 1)
  if (!Number.isInteger(requestedUnits) || requestedUnits < 1 || requestedUnits > MAX_UNITS_PER_PACK) {
    return { error: `Unidades por pacote deve estar entre 1 e ${MAX_UNITS_PER_PACK}` }
  }
  const variantTitle = body.variant_title ? String(body.variant_title).trim() : null
  const pack = resolvePackQuantity({
    rawSku: body.sku,
    configuredUnits: requestedUnits,
    titles: [variantTitle, title],
  })

  return {
    patch: {
      shopify_integration_id: body.shopify_integration_id ? String(body.shopify_integration_id) : null,
      title,
      variant_title: variantTitle,
      sku: pack.sku || null,
      units_per_pack: pack.unitsPerPack,
      price,
      currency: String(body.currency ?? 'EUR').trim().toUpperCase() || 'EUR',
      image_url: body.image_url ? String(body.image_url).trim() : null,
      source: 'manual' as const,
    },
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const integrationId = req.nextUrl.searchParams.get('integrationId')
  const includeHidden = req.nextUrl.searchParams.get('includeHidden') === 'true'

  let query = supabaseAdmin.from('shopify_products').select('*').order('title')
  if (integrationId) query = query.eq('shopify_integration_id', integrationId)
  if (!includeHidden) query = query.eq('hidden', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, products: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json()
  const parsed = parseCreatePatch(body)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('shopify_products').insert(parsed.patch).select().single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product: data })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json()

  if (Array.isArray(body.ids)) {
    if (typeof body.keep_local_copy !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'keep_local_copy invalido' }, { status: 400 })
    }
    const ids = body.ids
      .filter((id: unknown): id is string => typeof id === 'string')
      .map((id: string) => id.trim())
      .filter(Boolean)
    if (ids.length === 0 || ids.length !== body.ids.length || ids.some((id: string) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ ok: false, error: 'ids invalidos' }, { status: 400 })
    }
    try {
      const updated = await setKeepLocalCopies(ids, body.keep_local_copy)
      return NextResponse.json({ ok: true, updated })
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao atualizar copias locais',
      }, { status: 500 })
    }
  }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  if (body.keep_local_copy !== undefined) {
    if (typeof body.keep_local_copy !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'keep_local_copy inválido' }, { status: 400 })
    }
    await setKeepLocalCopy(id, body.keep_local_copy)
  }

  if (body.hidden === true) {
    await hideShopifyProduct(id)
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) return NextResponse.json({ ok: false, error: 'Nome obrigatório' }, { status: 400 })
    patch.title = title
  }
  if (body.variant_title !== undefined) patch.variant_title = body.variant_title ? String(body.variant_title).trim() : null
  if (body.sku !== undefined || body.units_per_pack !== undefined) {
    const requestedUnits = Number(body.units_per_pack ?? 1)
    if (!Number.isInteger(requestedUnits) || requestedUnits < 1 || requestedUnits > MAX_UNITS_PER_PACK) {
      return NextResponse.json({ ok: false, error: `Unidades por pacote deve estar entre 1 e ${MAX_UNITS_PER_PACK}` }, { status: 400 })
    }
    const pack = resolvePackQuantity({
      rawSku: body.sku,
      configuredUnits: requestedUnits,
      titles: [body.variant_title, body.title],
    })
    if (body.sku !== undefined) patch.sku = pack.sku || null
    patch.units_per_pack = pack.unitsPerPack
  }
  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ ok: false, error: 'Preço inválido' }, { status: 400 })
    patch.price = price
  }
  if (body.currency !== undefined) patch.currency = String(body.currency ?? 'EUR').trim().toUpperCase() || 'EUR'
  if (body.image_url !== undefined) patch.image_url = body.image_url ? String(body.image_url).trim() : null
  if (body.hidden === false) patch.hidden = false

  const { data, error } = await supabaseAdmin
    .from('shopify_products')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product: data })
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const id = String(req.nextUrl.searchParams.get('id') ?? '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('shopify_products')
    .select('id, source')
    .eq('id', id)
    .single()
  if (existingError || !existing) return NextResponse.json({ ok: false, error: 'Produto não encontrado' }, { status: 404 })

  if (existing.source === 'manual') {
    const { error } = await supabaseAdmin.from('shopify_products').delete().eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // source='shopify' rows are never hard-deleted — a resync would just bring
  // them back. Hiding is the equivalent "remove from view" action.
  await hideShopifyProduct(id)
  return NextResponse.json({ ok: true })
}

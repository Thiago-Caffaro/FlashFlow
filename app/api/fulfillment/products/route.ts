import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function parseProductPatch(body: Record<string, unknown>, partial = false) {
  const patch: Record<string, unknown> = {}

  if (!partial || body.country !== undefined) {
    const country = String(body.country ?? '').trim().toUpperCase()
    if (!country) return { error: 'País obrigatório' }
    patch.country = country
  }

  if (!partial || body.sku !== undefined) {
    const sku = String(body.sku ?? '').trim()
    if (!sku) return { error: 'SKU obrigatório' }
    patch.sku = sku
  }

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim()
    if (!name) return { error: 'Nome obrigatório' }
    patch.name = name
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) return { error: 'Preço inválido' }
    patch.price = price
  }

  if (!partial || body.currency !== undefined) {
    const currency = String(body.currency ?? 'EUR').trim().toUpperCase()
    if (!currency) return { error: 'Moeda obrigatória' }
    patch.currency = currency
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'Status ativo inválido' }
    patch.active = body.active
  } else if (!partial) {
    patch.active = true
  }

  return { patch }
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const country = req.nextUrl.searchParams.get('country')
  let query = supabaseAdmin.from('fulfillment_products').select('*').order('name')
  if (country) query = query.eq('country', country.toUpperCase())
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, products: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json()
  const parsed = parseProductPatch(body)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('fulfillment_products').insert({
    ...parsed.patch,
  }).select().single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product: data })
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json()
  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const parsed = parseProductPatch({ ...body, country: undefined }, true)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  if (!Object.keys(parsed.patch).length) {
    return NextResponse.json({ ok: false, error: 'Nenhum campo para atualizar' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('fulfillment_products')
    .select('id, country')
    .eq('id', id)
    .single()
  if (existingError || !existing) {
    return NextResponse.json({ ok: false, error: existingError?.message ?? 'Produto não encontrado' }, { status: 404 })
  }

  // O país determina qual integração/estoque o produto usa — não pode ser
  // trocado silenciosamente por um PUT, senão o produto passaria a apontar
  // para credenciais/estoque de outro país.
  if (body.country !== undefined) {
    const requestedCountry = String(body.country ?? '').trim().toUpperCase()
    if (requestedCountry !== existing.country) {
      return NextResponse.json({ ok: false, error: 'O país do produto não pode ser alterado; crie um novo produto.' }, { status: 400 })
    }
  }

  const { data: mirror, error: mirrorError } = await supabaseAdmin
    .from('shopify_products')
    .select('id')
    .eq('local_product_id', id)
    .maybeSingle()
  if (mirrorError) {
    return NextResponse.json({ ok: false, error: mirrorError.message }, { status: 500 })
  }
  if (mirror) {
    return NextResponse.json({
      ok: false,
      error: 'Este produto é espelhado do catálogo Shopify; edite pela tela de produtos reais.',
    }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('fulfillment_products')
    .update({ ...parsed.patch, updated_at: new Date().toISOString() })
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

  const { data: mirror, error: mirrorError } = await supabaseAdmin
    .from('shopify_products')
    .select('id')
    .eq('local_product_id', id)
    .maybeSingle()
  if (mirrorError) {
    return NextResponse.json({ ok: false, error: mirrorError.message }, { status: 500 })
  }
  if (mirror) {
    return NextResponse.json({
      ok: false,
      error: 'Este produto é espelhado do catálogo Shopify; altere a cópia local pela tela de produtos reais.',
    }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('fulfillment_products')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product: data })
}

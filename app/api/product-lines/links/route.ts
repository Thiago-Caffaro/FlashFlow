import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { catalogIntegrationExists } from '@/lib/product-lines'
import type { CatalogPlatform } from '@/types'

export const dynamic = 'force-dynamic'

function isPlatform(value: unknown): value is CatalogPlatform {
  return value === 'shopify' || value === 'lightfunnels'
}

// Vincula um produto do catálogo de uma loja a um produto de linha. Um
// produto do catálogo pertence a um só produto de linha: se já estiver
// vinculado a outro, o vínculo é movido.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const lineProductId = String(body.line_product_id ?? '').trim()
  const integrationId = String(body.integration_id ?? '').trim()
  const externalProductId = String(body.external_product_id ?? '').trim()
  const title = String(body.title ?? '').trim().slice(0, 300)
  const platform = body.platform
  if (!lineProductId) return NextResponse.json({ ok: false, error: 'Produto de linha obrigatório' }, { status: 400 })
  if (!isPlatform(platform)) return NextResponse.json({ ok: false, error: 'Plataforma inválida' }, { status: 400 })
  if (!integrationId || !externalProductId) {
    return NextResponse.json({ ok: false, error: 'Produto do catálogo obrigatório' }, { status: 400 })
  }

  try {
    if (!(await catalogIntegrationExists(platform, integrationId))) {
      return NextResponse.json({ ok: false, error: 'Loja não encontrada' }, { status: 404 })
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }

  const { data, error } = await supabaseAdmin
    .from('product_catalog_links')
    .upsert({
      line_product_id: lineProductId,
      platform,
      integration_id: integrationId,
      external_product_id: externalProductId,
      title,
    }, { onConflict: 'platform,integration_id,external_product_id' })
    .select()
    .single()
  if (error?.code === '23503') return NextResponse.json({ ok: false, error: 'Produto de linha não encontrado' }, { status: 404 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, link: data })
}

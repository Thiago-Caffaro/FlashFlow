import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  LIGHTFUNNELS_PRODUCT_PUBLIC_SELECT,
  setLightfunnelsKeepLocalCopy,
  setLightfunnelsProductHidden,
} from '@/lib/lightfunnels-products-service'

export const dynamic = 'force-dynamic'

// GET /api/fulfillment/lightfunnels/products?integrationId=&includeHidden=1
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const integrationId = req.nextUrl.searchParams.get('integrationId')
  const includeHidden = req.nextUrl.searchParams.get('includeHidden') === '1'
  let query = supabaseAdmin
    .from('lightfunnels_products')
    .select(LIGHTFUNNELS_PRODUCT_PUBLIC_SELECT)
    .order('title')
    .limit(2000)
  if (integrationId) query = query.eq('lightfunnels_integration_id', integrationId)
  if (!includeHidden) query = query.eq('hidden', false)
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, products: data ?? [] })
}

// PATCH — { ids: string[], keep_local_copy: boolean } ou { id: string, hidden: boolean }
export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  try {
    if (Array.isArray(body.ids) && typeof body.keep_local_copy === 'boolean') {
      const updated = await setLightfunnelsKeepLocalCopy(body.ids.map((id) => String(id)), body.keep_local_copy)
      return NextResponse.json({ ok: true, updated })
    }
    if (typeof body.id === 'string' && typeof body.hidden === 'boolean') {
      await setLightfunnelsProductHidden(body.id, body.hidden)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: 'Informe { ids, keep_local_copy } ou { id, hidden }' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

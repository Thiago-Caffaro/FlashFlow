import { NextRequest, NextResponse } from 'next/server'
import { updateAbandonedCheckout } from '@/lib/shopify-confirmation-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const country = req.nextUrl.searchParams.get('country')
  let query = supabaseAdmin
    .from('shopify_abandoned_checkouts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (country) query = query.eq('country', country.toUpperCase())
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, checkouts: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json()
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const checkout = await updateAbandonedCheckout(id, body)
    return NextResponse.json({ ok: true, checkout })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

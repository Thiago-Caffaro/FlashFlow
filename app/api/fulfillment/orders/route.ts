import { NextRequest, NextResponse } from 'next/server'
import { createFulfillmentOrder } from '@/lib/fulfillment-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const instance = req.nextUrl.searchParams.get('instance')
  const country = req.nextUrl.searchParams.get('country')
  let query = supabaseAdmin.from('fulfillment_orders').select('*').order('created_at', { ascending: false }).limit(200)
  if (instance) query = query.eq('instance_name', instance)
  if (country) query = query.eq('country', country.toUpperCase())
  const { data, error } = await query
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, orders: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const order = await createFulfillmentOrder(await req.json())
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 400 })
  }
}


import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LIGHTFUNNELS_INTEGRATION_PUBLIC_SELECT } from '@/lib/lightfunnels-integration-store'

export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// GET /api/fulfillment/lightfunnels/integrations — contas Lightfunnels conectadas
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .select(LIGHTFUNNELS_INTEGRATION_PUBLIC_SELECT)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, integrations: data ?? [] })
}

// PUT /api/fulfillment/lightfunnels/integrations — { id, name?, default_country?, writeback_enabled?, active? }
// Tokens só mudam pelo OAuth (reconectar).
export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const id = text(body.id)
  if (!id) return NextResponse.json({ ok: false, error: 'id obrigatório' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const name = text(body.name)
    if (!name || name.length > 120) return NextResponse.json({ ok: false, error: 'Nome inválido' }, { status: 400 })
    patch.name = name
  }
  if (body.default_country !== undefined) {
    const country = text(body.default_country).toUpperCase()
    if (!country || country.length > 64) return NextResponse.json({ ok: false, error: 'País inválido' }, { status: 400 })
    patch.default_country = country
  }
  if (body.writeback_enabled !== undefined) {
    if (typeof body.writeback_enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'writeback_enabled deve ser booleano' }, { status: 400 })
    }
    patch.writeback_enabled = body.writeback_enabled
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ ok: false, error: 'active deve ser booleano' }, { status: 400 })
    patch.active = body.active
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ ok: false, error: 'Nenhuma alteração informada' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .update(patch)
    .eq('id', id)
    .select(LIGHTFUNNELS_INTEGRATION_PUBLIC_SELECT)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, integration: data })
}

// DELETE /api/fulfillment/lightfunnels/integrations?id= — desativa (soft);
// pedidos e catálogo ficam.
export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const id = text(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ ok: false, error: 'id obrigatório' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('lightfunnels_integrations')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(LIGHTFUNNELS_INTEGRATION_PUBLIC_SELECT)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, integration: data })
}

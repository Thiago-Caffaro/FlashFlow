import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isUniqueViolation, parseLineProductInput } from '@/lib/product-line-match'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const parsed = parseLineProductInput(body, true)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('line_products')
    .update({ ...parsed.patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (isUniqueViolation(error)) return NextResponse.json({ ok: false, error: 'Já existe um produto com esse nome' }, { status: 409 })
  if (error?.code === '23503') return NextResponse.json({ ok: false, error: 'Linha não encontrada' }, { status: 404 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Produto não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true, product: data })
}

// Apaga o produto e seus vínculos de catálogo (ON DELETE CASCADE).
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const { data, error } = await supabaseAdmin.from('line_products').delete().eq('id', id).select('id').maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Produto não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

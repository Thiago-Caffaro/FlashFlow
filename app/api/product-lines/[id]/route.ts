import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isUniqueViolation, parseProductLineInput } from '@/lib/product-line-match'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const parsed = parseProductLineInput(body, true)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('product_lines')
    .update({ ...parsed.patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (isUniqueViolation(error)) return NextResponse.json({ ok: false, error: 'Já existe uma linha com esse código' }, { status: 409 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Linha não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, line: data })
}

// Apaga a linha junto com seus produtos e vínculos (ON DELETE CASCADE).
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const { data, error } = await supabaseAdmin.from('product_lines').delete().eq('id', id).select('id').maybeSingle()
  // automations.product_line_id é ON DELETE RESTRICT (migration 030).
  if (error?.code === '23503') {
    return NextResponse.json({ ok: false, error: 'Linha usada por uma automação — apague ou mude a automação antes' }, { status: 409 })
  }
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Linha não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

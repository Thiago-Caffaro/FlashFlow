import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isUniqueViolation, parseLineProductInput } from '@/lib/product-line-match'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const parsed = parseLineProductInput(body)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('line_products').insert(parsed.patch).select().single()
  if (isUniqueViolation(error)) return NextResponse.json({ ok: false, error: 'Já existe um produto com esse nome' }, { status: 409 })
  // 23503 = foreign_key_violation: linha inexistente.
  if (error?.code === '23503') return NextResponse.json({ ok: false, error: 'Linha não encontrada' }, { status: 404 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, product: data })
}

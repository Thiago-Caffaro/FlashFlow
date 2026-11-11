import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listProductLinesWithProducts } from '@/lib/product-lines'
import { isUniqueViolation, parseProductLineInput } from '@/lib/product-line-match'

export const dynamic = 'force-dynamic'

// Linhas de produto com seus produtos e vínculos de catálogo — tabelas
// globais (não particionadas por instância WhatsApp).
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const lines = await listProductLinesWithProducts()
    return NextResponse.json({ ok: true, lines })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const parsed = parseProductLineInput(body)
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('product_lines').insert(parsed.patch).select().single()
  if (isUniqueViolation(error)) return NextResponse.json({ ok: false, error: 'Já existe uma linha com esse código' }, { status: 409 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, line: data })
}

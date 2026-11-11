import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { listCatalogProductOptions } from '@/lib/product-lines'

export const dynamic = 'force-dynamic'

// Produtos do catálogo de todas as lojas, para vincular a produtos de linha.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const products = await listCatalogProductOptions()
    return NextResponse.json({ ok: true, products })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

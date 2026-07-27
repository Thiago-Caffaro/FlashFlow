import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { isCommercialStatus, updateConfirmationOrder } from '@/lib/shopify-confirmation-service'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const body = await req.json()
  const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : []
  const ids: string[] = [...new Set(rawIds.map((id) => String(id)).filter((id) => id.length > 0))]
  if (!ids.length) return NextResponse.json({ ok: false, error: 'Nenhum pedido selecionado' }, { status: 400 })
  if (!isCommercialStatus(body.commercial_status)) {
    return NextResponse.json({ ok: false, error: 'Status comercial inválido' }, { status: 400 })
  }

  let succeeded = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of ids) {
    try {
      await updateConfirmationOrder(id, { commercial_status: body.commercial_status })
      succeeded += 1
    } catch (error) {
      errors.push({ id, error: error instanceof Error ? error.message : 'Erro inesperado' })
    }
  }

  return NextResponse.json({ ok: true, succeeded, failed: errors.length, errors })
}

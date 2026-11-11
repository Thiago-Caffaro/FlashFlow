import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import {
  AutomationError,
  deleteAutomation,
  getAutomation,
  setAutomationEnabled,
  updateAutomation,
} from '@/lib/automations'
import { parseAutomationInput } from '@/lib/automation-rules'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof AutomationError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    const automation = await getAutomation(id)
    if (!automation) return NextResponse.json({ ok: false, error: 'Automação não encontrada' }, { status: 404 })
    return NextResponse.json({ ok: true, automation })
  } catch (error) {
    return errorResponse(error)
  }
}

// Edição completa (assistente).
export async function PUT(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const parsed = parseAutomationInput(await req.json().catch(() => ({})))
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, automation: await updateAutomation(id, parsed.value) })
  } catch (error) {
    return errorResponse(error)
  }
}

// Liga/desliga (botão do card): { enabled: boolean }.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ ok: false, error: 'enabled obrigatório' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, automation: await setAutomationEnabled(id, body.enabled) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    if (!(await deleteAutomation(id))) return NextResponse.json({ ok: false, error: 'Automação não encontrada' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

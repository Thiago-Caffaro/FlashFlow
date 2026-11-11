import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { AutomationError, createAutomation, listAutomations } from '@/lib/automations'
import { parseAutomationInput } from '@/lib/automation-rules'

export const dynamic = 'force-dynamic'

// Automações simples — globais (cada uma escolhe o próprio número), por isso
// sem filtro de instância.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, automations: await listAutomations() })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const parsed = parseAutomationInput(await req.json().catch(() => ({})))
  if ('error' in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  try {
    const automation = await createAutomation(parsed.value)
    return NextResponse.json({ ok: true, automation })
  } catch (error) {
    if (error instanceof AutomationError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

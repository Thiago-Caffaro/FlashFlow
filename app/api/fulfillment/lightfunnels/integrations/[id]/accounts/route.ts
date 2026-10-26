import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { loadLightfunnelsIntegration } from '@/lib/lightfunnels-integration-store'
import { listLightfunnelsStoreAccounts, replaceLightfunnelsStoreAccounts } from '@/lib/lightfunnels-store-accounts'
import type { LightfunnelsStoreAccountLink } from '@/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function parseLinks(value: unknown): LightfunnelsStoreAccountLink[] | null {
  if (!Array.isArray(value)) return null
  const links: LightfunnelsStoreAccountLink[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const instanceName = typeof row.instance_name === 'string' ? row.instance_name.trim() : ''
    if (!instanceName) return null
    if (row.funnel_ids !== undefined && !Array.isArray(row.funnel_ids)) return null
    const priority = Number(row.priority ?? 100)
    links.push({
      instance_name: instanceName,
      priority: Number.isFinite(priority) ? priority : 100,
      enabled: row.enabled !== false,
      funnel_ids: Array.isArray(row.funnel_ids) ? row.funnel_ids.map((id) => String(id)) : [],
    })
  }
  return links
}

// GET /api/fulfillment/lightfunnels/integrations/[id]/accounts — contas
// WhatsApp vinculadas (com os funis de cada vínculo)
export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    if (!(await loadLightfunnelsIntegration(id))) {
      return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, accounts: await listLightfunnelsStoreAccounts(id) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

// PUT — substitui os vínculos: { accounts: [{ instance_name, priority, enabled, funnel_ids }] }.
// funnel_ids vazio = todos os funis. Lista vazia devolve a conta Lightfunnels
// à regra geral (conta padrão de pedidos ou país).
export async function PUT(req: NextRequest, { params }: RouteContext) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  let body: { accounts?: unknown }
  try {
    body = await req.json() as { accounts?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const links = parseLinks(body.accounts)
  if (!links) {
    return NextResponse.json({
      ok: false,
      error: 'accounts deve ser uma lista de { instance_name, priority, enabled, funnel_ids }',
    }, { status: 400 })
  }

  try {
    if (!(await loadLightfunnelsIntegration(id))) {
      return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, accounts: await replaceLightfunnelsStoreAccounts(id, links) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    const status = message.startsWith('Conta WhatsApp inválida') ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

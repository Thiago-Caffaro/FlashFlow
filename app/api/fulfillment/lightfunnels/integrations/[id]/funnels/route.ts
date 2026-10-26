import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { loadLightfunnelsIntegration } from '@/lib/lightfunnels-integration-store'
import { lightfunnelsClientFor } from '@/lib/lightfunnels-token'
import type { LightfunnelsFunnel } from '@/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const MAX_PAGES = 10

// GET /api/fulfillment/lightfunnels/integrations/[id]/funnels — funis da
// conta, ao vivo, para o seletor de funil dos vínculos.
export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    const integration = await loadLightfunnelsIntegration(id)
    if (!integration) return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
    const client = await lightfunnelsClientFor(integration)

    const funnels: LightfunnelsFunnel[] = []
    let after: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.listFunnelsPage({ first: 50, after })
      funnels.push(...result.nodes.map((node) => ({
        id: String(node.id),
        name: String(node.name ?? '').trim() || String(node.id),
        published: node.published === true,
      })))
      if (!result.hasNextPage || !result.endCursor) break
      after = result.endCursor
    }
    return NextResponse.json({ ok: true, funnels })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 502 })
  }
}

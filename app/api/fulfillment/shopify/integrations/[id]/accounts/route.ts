import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listShopifyStoreAccounts, replaceShopifyStoreAccounts } from '@/lib/shopify-store-accounts'
import type { ShopifyStoreAccountLink } from '@/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function integrationExists(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

function parseLinks(value: unknown): ShopifyStoreAccountLink[] | null {
  if (!Array.isArray(value)) return null
  const links: ShopifyStoreAccountLink[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const instanceName = typeof row.instance_name === 'string' ? row.instance_name.trim() : ''
    if (!instanceName) return null
    const priority = Number(row.priority ?? 100)
    links.push({
      instance_name: instanceName,
      priority: Number.isFinite(priority) ? priority : 100,
      enabled: row.enabled !== false,
    })
  }
  return links
}

// GET /api/fulfillment/shopify/integrations/[id]/accounts — contas WhatsApp da loja
export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { id } = await params
  try {
    if (!(await integrationExists(id))) return NextResponse.json({ ok: false, error: 'Loja não encontrada' }, { status: 404 })
    return NextResponse.json({ ok: true, accounts: await listShopifyStoreAccounts(id) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, { status: 500 })
  }
}

// PUT /api/fulfillment/shopify/integrations/[id]/accounts — substitui os
// vínculos: { accounts: [{ instance_name, priority, enabled }] }. Lista vazia
// devolve a loja à regra geral.
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
  if (!links) return NextResponse.json({ ok: false, error: 'accounts deve ser uma lista de { instance_name, priority, enabled }' }, { status: 400 })

  try {
    if (!(await integrationExists(id))) return NextResponse.json({ ok: false, error: 'Loja não encontrada' }, { status: 404 })
    return NextResponse.json({ ok: true, accounts: await replaceShopifyStoreAccounts(id, links) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    const status = message.startsWith('Conta WhatsApp inválida') ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

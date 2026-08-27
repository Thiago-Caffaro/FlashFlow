import { NextRequest, NextResponse } from 'next/server'
import { syncWhatsAppTemplates } from '@/lib/whatsapp-templates'

// POST /api/whatsapp-cloud/templates/sync — sincronização sob demanda (botão
// "Sincronizar" na UI), não em tempo real via webhook nesta fase. Body:
// { instance: string }
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const instance = body && typeof body === 'object' ? (body as Record<string, unknown>).instance : null
  if (typeof instance !== 'string' || !instance) {
    return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
  }

  try {
    const result = await syncWhatsAppTemplates(instance)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[whatsapp-cloud/templates/sync] erro ao sincronizar:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao sincronizar templates' },
      { status: 500 }
    )
  }
}

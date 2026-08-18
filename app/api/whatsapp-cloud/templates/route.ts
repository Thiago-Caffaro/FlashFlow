import { NextRequest, NextResponse } from 'next/server'
import { loadWhatsAppTemplates } from '@/lib/whatsapp-templates'

// GET /api/whatsapp-cloud/templates?instance=<instance_name> — lista os
// templates já sincronizados localmente (não bate na Meta a cada leitura,
// só lê o que a última sincronização gravou).
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) {
    return NextResponse.json({ ok: false, error: 'instance é obrigatório' }, { status: 400 })
  }
  try {
    const templates = await loadWhatsAppTemplates(instance)
    return NextResponse.json({ ok: true, templates })
  } catch (error) {
    console.error('[whatsapp-cloud/templates] erro ao carregar:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao carregar templates' },
      { status: 500 }
    )
  }
}

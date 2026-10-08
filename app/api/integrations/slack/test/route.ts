import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { postSlackHandoff } from '@/lib/slack-notifications'

export const dynamic = 'force-dynamic'

// POST { instance } — mensagem de teste no canal padrão da conta, sem botão
// "Assumir" (não há conversa por trás).
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  let body: { instance?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const instanceName = typeof body.instance === 'string' ? body.instance.trim().slice(0, 200) : ''
  if (!instanceName) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  try {
    const result = await postSlackHandoff({
      instanceName,
      source: 'test',
      title: 'Teste de integração do FlashFlow',
      message: 'Se você está vendo esta mensagem, as notificações desta conta WhatsApp chegam neste canal.',
      originLabel: 'Teste manual (aba Integrações)',
      claimable: false,
    })
    return NextResponse.json({ ok: true, channelId: result.channelId })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao enviar mensagem de teste',
    }, { status: 502 })
  }
}

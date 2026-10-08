import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { getInstanceSlackSettings, isSlackMention, saveInstanceSlackSettings } from '@/lib/slack-settings'
import type { SlackNotificationSettings } from '@/types'

export const dynamic = 'force-dynamic'

const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{6,30}$/
const FORWARD_FIELDS = ['forward_ai_escalation', 'forward_flow_notify', 'forward_outside_window'] as const

function instanceFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : ''
}

// GET ?instance= — regras de encaminhamento ao Slack desta conta WhatsApp.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const instanceName = instanceFrom(req.nextUrl.searchParams.get('instance'))
  if (!instanceName) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, settings: await getInstanceSlackSettings(instanceName) })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao carregar configuração do Slack',
    }, { status: 500 })
  }
}

// PUT { instance, channel_id?, channel_name?, mention?, forward_*? } —
// allowlist explícita de campos.
export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const instanceName = instanceFrom(body.instance)
  if (!instanceName) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const patch: Partial<Omit<SlackNotificationSettings, 'instance_name'>> = {}
  if (body.channel_id !== undefined) {
    if (body.channel_id === null || body.channel_id === '') {
      patch.channel_id = null
      patch.channel_name = null
    } else if (typeof body.channel_id === 'string' && CHANNEL_ID_PATTERN.test(body.channel_id)) {
      patch.channel_id = body.channel_id
      patch.channel_name = typeof body.channel_name === 'string' ? body.channel_name.slice(0, 200) : null
    } else {
      return NextResponse.json({ ok: false, error: 'Canal do Slack inválido' }, { status: 400 })
    }
  }
  if (body.mention !== undefined) {
    if (!isSlackMention(body.mention)) return NextResponse.json({ ok: false, error: 'Menção inválida' }, { status: 400 })
    patch.mention = body.mention
  }
  for (const field of FORWARD_FIELDS) {
    if (body[field] === undefined) continue
    if (typeof body[field] !== 'boolean') {
      return NextResponse.json({ ok: false, error: `${field} deve ser booleano` }, { status: 400 })
    }
    patch[field] = body[field]
  }

  try {
    const current = await getInstanceSlackSettings(instanceName)
    const next = { ...current, ...patch }
    const forwardingOn = FORWARD_FIELDS.some((field) => next[field])
    if (forwardingOn && !next.channel_id) {
      return NextResponse.json({ ok: false, error: 'Escolha o canal padrão antes de ativar um encaminhamento' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, settings: await saveInstanceSlackSettings(instanceName, patch) })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao salvar configuração do Slack',
    }, { status: 500 })
  }
}

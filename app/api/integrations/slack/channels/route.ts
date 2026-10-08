import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { slackListChannels } from '@/lib/slack-client'
import { getSlackCredentials } from '@/lib/slack-settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const credentials = await getSlackCredentials()
  if (!credentials) {
    return NextResponse.json({ ok: false, error: 'Slack não conectado' }, { status: 409 })
  }
  try {
    const channels = await slackListChannels(credentials.botToken)
    return NextResponse.json({ ok: true, channels })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao listar canais do Slack',
    }, { status: 502 })
  }
}

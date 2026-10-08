import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { SlackApiError, slackAuthTest } from '@/lib/slack-client'
import {
  SLACK_INTERACTIVITY_PATH,
  deleteSlackCredentials,
  getAppBaseUrl,
  getSlackCredentials,
  saveSlackCredentials,
} from '@/lib/slack-settings'
import type { SlackConnectionStatus } from '@/types'

export const dynamic = 'force-dynamic'

const BOT_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]{10,250}$/
const SIGNING_SECRET_PATTERN = /^[A-Za-z0-9]{16,128}$/

async function connectionStatus(): Promise<SlackConnectionStatus> {
  const baseUrl = await getAppBaseUrl()
  const credentials = await getSlackCredentials()
  const base: SlackConnectionStatus = {
    connected: false,
    teamName: null,
    botName: null,
    hasSigningSecret: Boolean(credentials?.signingSecret),
    interactivityUrl: baseUrl ? `${baseUrl}${SLACK_INTERACTIVITY_PATH}` : null,
    error: null,
  }
  if (!credentials) return base
  try {
    const info = await slackAuthTest(credentials.botToken)
    return { ...base, connected: true, teamName: info.teamName, botName: info.botName }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : 'Falha ao validar token do Slack' }
  }
}

// GET: estado da conexão. Nunca devolve token nem signing secret.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  return NextResponse.json({ ok: true, status: await connectionStatus() })
}

// PUT { botToken?, signingSecret? } — o token é validado no Slack (auth.test)
// antes de ser salvo; campos omitidos mantêm o valor atual.
export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  let body: { botToken?: unknown; signingSecret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : ''
  const signingSecret = typeof body.signingSecret === 'string' ? body.signingSecret.trim() : ''
  if (!botToken && !signingSecret) {
    return NextResponse.json({ ok: false, error: 'Informe o token do bot e/ou o signing secret' }, { status: 400 })
  }
  if (botToken && !BOT_TOKEN_PATTERN.test(botToken)) {
    return NextResponse.json({ ok: false, error: 'Token inválido — use o Bot User OAuth Token, que começa com xoxb-' }, { status: 400 })
  }
  if (signingSecret && !SIGNING_SECRET_PATTERN.test(signingSecret)) {
    return NextResponse.json({ ok: false, error: 'Signing secret inválido — copie de Basic Information → App Credentials' }, { status: 400 })
  }
  if (!botToken && !(await getSlackCredentials())) {
    return NextResponse.json({ ok: false, error: 'Conecte o token do bot primeiro' }, { status: 400 })
  }

  if (botToken) {
    try {
      await slackAuthTest(botToken)
    } catch (error) {
      const message = error instanceof SlackApiError ? error.message : 'Não foi possível validar o token no Slack'
      return NextResponse.json({ ok: false, error: message }, { status: 400 })
    }
  }

  try {
    await saveSlackCredentials({ botToken: botToken || undefined, signingSecret: signingSecret || undefined })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao salvar credenciais do Slack',
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status: await connectionStatus() })
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    await deleteSlackCredentials()
    return NextResponse.json({ ok: true, status: await connectionStatus() })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao desconectar o Slack',
    }, { status: 500 })
  }
}

import 'server-only'
import type { SlackChannel } from '@/types'

// Cliente mínimo da Web API do Slack (https://docs.slack.dev/apis/web-api).
// A Web API responde HTTP 200 mesmo em erro lógico — o sucesso vem em
// `ok: true`; falhas trazem `error` (ex: channel_not_found, not_in_channel,
// invalid_auth). 429 traz Retry-After em segundos.

const SLACK_API_BASE = 'https://slack.com/api'
const REQUEST_TIMEOUT_MS = 10_000

export class SlackApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'SlackApiError'
  }
}

// Mensagens em português para os erros que o operador consegue resolver.
const ERROR_HINTS: Record<string, string> = {
  invalid_auth: 'Token do Slack inválido — confira o Bot User OAuth Token (xoxb-...)',
  not_authed: 'Token do Slack ausente',
  token_revoked: 'Token do Slack revogado — reinstale o app no workspace',
  account_inactive: 'App do Slack desativado no workspace',
  channel_not_found: 'Canal do Slack não encontrado — escolha o canal de novo na aba Integrações',
  not_in_channel: 'O bot não está no canal privado — no Slack, use /invite @FlashFlow nesse canal',
  is_archived: 'O canal do Slack está arquivado',
  missing_scope: 'O app do Slack não tem as permissões necessárias — confira os escopos no guia de configuração',
  rate_limited: 'Limite de envio do Slack atingido — tente de novo em instantes',
  invalid_blocks: 'Mensagem do Slack com formato inválido',
  msg_too_long: 'Mensagem longa demais para o Slack',
}

function describeSlackError(code: string): string {
  return ERROR_HINTS[code] ?? `Erro da API do Slack: ${code}`
}

type SlackResponse = { ok: boolean; error?: string } & Record<string, unknown>

async function callSlack<T extends SlackResponse>(
  token: string,
  method: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${SLACK_API_BASE}/${method}`)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)

  let response: Response
  try {
    response = await fetch(url, {
      method: options.query ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new SlackApiError(
      timedOut ? 'timeout' : 'network_error',
      timedOut ? 'Slack não respondeu a tempo' : 'Falha de rede ao falar com o Slack'
    )
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new SlackApiError(
      'rate_limited',
      describeSlackError('rate_limited'),
      Number.isFinite(retryAfter) ? retryAfter : undefined
    )
  }

  let json: T
  try {
    json = await response.json() as T
  } catch {
    throw new SlackApiError('invalid_response', `Resposta inválida do Slack (HTTP ${response.status})`)
  }
  if (!json.ok) {
    const code = typeof json.error === 'string' ? json.error : 'unknown_error'
    // missing_scope vem com o escopo exigido e os que o token tem — é
    // exatamente o que o operador precisa para corrigir o app no Slack.
    const scopeDetail = code === 'missing_scope' && typeof json.needed === 'string'
      ? ` (falta: ${json.needed}; o token tem: ${typeof json.provided === 'string' ? json.provided : 'nenhum'} — depois de adicionar, reinstale o app e, se o token mudar, atualize as credenciais)`
      : ''
    throw new SlackApiError(code, `${describeSlackError(code)}${scopeDetail}`)
  }
  return json
}

export interface SlackAuthInfo {
  teamId: string
  teamName: string
  botUserId: string
  botName: string
}

export async function slackAuthTest(token: string): Promise<SlackAuthInfo> {
  const json = await callSlack<SlackResponse & { team?: string; team_id?: string; user?: string; user_id?: string }>(
    token,
    'auth.test'
  )
  return {
    teamId: String(json.team_id ?? ''),
    teamName: String(json.team ?? ''),
    botUserId: String(json.user_id ?? ''),
    botName: String(json.user ?? ''),
  }
}

export interface SlackMessagePayload {
  channel: string
  text: string
  blocks?: unknown[]
}

export async function slackPostMessage(token: string, payload: SlackMessagePayload): Promise<{ channel: string; ts: string }> {
  const json = await callSlack<SlackResponse & { channel?: string; ts?: string }>(token, 'chat.postMessage', {
    body: { ...payload, unfurl_links: false, unfurl_media: false },
  })
  return { channel: String(json.channel ?? payload.channel), ts: String(json.ts ?? '') }
}

export async function slackUpdateMessage(
  token: string,
  payload: SlackMessagePayload & { ts: string }
): Promise<void> {
  await callSlack(token, 'chat.update', { body: { ...payload } })
}

// Canais não arquivados. Só canais públicos (escopo channels:read). Canal privado é usado pelo ID
// colado na aba Integrações, depois de convidar o bot com /invite.
export async function slackListChannels(token: string, maxChannels = 1000): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = []
  let cursor = ''
  do {
    const json = await callSlack<SlackResponse & {
      channels?: Array<{ id?: string; name?: string; is_private?: boolean; is_member?: boolean }>
      response_metadata?: { next_cursor?: string }
    }>(token, 'conversations.list', {
      query: {
        types: 'public_channel',
        exclude_archived: 'true',
        limit: '200',
        ...(cursor ? { cursor } : {}),
      },
    })
    for (const channel of json.channels ?? []) {
      if (!channel.id || !channel.name) continue
      channels.push({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private === true,
        is_member: channel.is_member === true,
      })
    }
    cursor = json.response_metadata?.next_cursor ?? ''
  } while (cursor && channels.length < maxChannels)
  return channels.sort((a, b) => a.name.localeCompare(b.name))
}

// response_url vem no payload de interatividade (já com assinatura
// verificada), mas só aceitamos o host oficial — nunca postar para uma URL
// arbitrária.
export async function slackRespond(responseUrl: string, body: Record<string, unknown>): Promise<void> {
  const url = new URL(responseUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com') {
    throw new SlackApiError('invalid_response_url', 'response_url do Slack inválida')
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new SlackApiError('response_url_failed', `Slack recusou a resposta (HTTP ${response.status})`)
}

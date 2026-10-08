import { NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature } from '@/lib/slack-signature'
import { getSlackCredentials, getSlackSigningSecret } from '@/lib/slack-settings'
import { buildClaimedBlocks, SLACK_CLAIM_ACTION_ID } from '@/lib/slack-blocks'
import { slackRespond, slackUpdateMessage } from '@/lib/slack-client'
import { applySlackClaim, claimSlackMessage } from '@/lib/slack-notifications'

export const dynamic = 'force-dynamic'

// Request URL de interatividade do app Slack
// (https://docs.slack.dev/interactivity/handling-user-interaction).
// Rota pública (proxy.ts) autenticada pela assinatura do Slack. O Slack
// exige resposta 200 em até 3s: o clique é registrado no banco antes de
// responder (para saber quem venceu), e a atualização da mensagem no Slack
// e os efeitos no FlashFlow rodam depois da resposta.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]+$/

type InteractionPayload = {
  type?: string
  user?: { id?: string; username?: string; name?: string }
  channel?: { id?: string }
  container?: { channel_id?: string; message_ts?: string }
  message?: { ts?: string; blocks?: unknown[] }
  actions?: Array<{ action_id?: string; value?: string }>
  response_url?: string
}

function ack() {
  return new NextResponse(null, { status: 200 })
}

function runAfterResponse(task: () => Promise<void>) {
  void task().catch((error) => {
    console.error('[slack-interactivity]', error instanceof Error ? error.message : error)
  })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signingSecret = await getSlackSigningSecret()
  if (!signingSecret) {
    return NextResponse.json({ ok: false, error: 'Slack signing secret not configured' }, { status: 503 })
  }
  const valid = verifySlackSignature({
    rawBody,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    signingSecret,
  })
  if (!valid) return NextResponse.json({ ok: false, error: 'Invalid Slack signature' }, { status: 401 })

  let payload: InteractionPayload
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '') as InteractionPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  // Qualquer outra interação (inclusive o botão de link "Abrir FlashFlow",
  // que também gera payload) só precisa do 200.
  if (payload.type !== 'block_actions') return ack()
  const action = payload.actions?.find((item) => item.action_id === SLACK_CLAIM_ACTION_ID)
  if (!action) return ack()

  const slackMessageId = String(action.value ?? '')
  const userId = String(payload.user?.id ?? '')
  const responseUrl = payload.response_url ?? ''
  if (!UUID_PATTERN.test(slackMessageId) || !SLACK_USER_ID_PATTERN.test(userId)) {
    return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 })
  }
  const userName = String(payload.user?.name || payload.user?.username || userId)

  const { claimed, row } = await claimSlackMessage(slackMessageId, { userId, name: userName })

  if (!row) {
    runAfterResponse(async () => {
      if (responseUrl) {
        await slackRespond(responseUrl, {
          response_type: 'ephemeral',
          replace_original: false,
          text: 'Esta solicitação não existe mais no FlashFlow.',
        })
      }
    })
    return ack()
  }

  if (!claimed) {
    runAfterResponse(async () => {
      if (responseUrl) {
        await slackRespond(responseUrl, {
          response_type: 'ephemeral',
          replace_original: false,
          text: `Este atendimento já foi assumido por ${row.claimed_by_name ?? 'outra pessoa'}.`,
        })
      }
    })
    return ack()
  }

  const channelId = payload.channel?.id ?? payload.container?.channel_id ?? ''
  const messageTs = payload.message?.ts ?? payload.container?.message_ts ?? ''
  const originalBlocks = Array.isArray(payload.message?.blocks) ? payload.message.blocks : []
  runAfterResponse(async () => {
    await applySlackClaim(row, userName)
    const credentials = await getSlackCredentials()
    if (credentials && channelId && messageTs) {
      await slackUpdateMessage(credentials.botToken, {
        channel: channelId,
        ts: messageTs,
        text: `Atendimento assumido por ${userName}`,
        blocks: buildClaimedBlocks(originalBlocks, userId, new Date()),
      })
    }
  })
  return ack()
}

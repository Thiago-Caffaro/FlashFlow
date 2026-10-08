import type { SlackMention } from '@/types'

// Mensagens do FlashFlow no Slack em Block Kit
// (https://docs.slack.dev/reference/block-kit). Texto vindo de cliente/fluxo
// é sempre escapado: no mrkdwn do Slack, "<...>" vira menção/link — um nome
// de contato "<!channel>" notificaria o canal inteiro.

export const SLACK_CLAIM_ACTION_ID = 'flashflow_claim'
export const SLACK_OPEN_ACTION_ID = 'flashflow_open'
const ACTIONS_BLOCK_ID = 'flashflow_actions'

const HEADER_MAX = 150
const SECTION_MAX = 3000
const FIELD_MAX = 2000

type Block = Record<string, unknown>

export function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function mentionToken(mention: SlackMention): string {
  if (mention === 'here') return '<!here>'
  if (mention === 'channel') return '<!channel>'
  return ''
}

// Data renderizada no fuso de quem lê (formatação de data do Slack).
function slackDate(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000)
  return `<!date^${unix}^{date_short_pretty} {time}|${date.toISOString()}>`
}

export interface HandoffMessageInput {
  slackMessageId: string
  title: string
  message: string
  mention: SlackMention
  instanceName: string
  originLabel: string
  contactName: string | null
  contactPhone: string | null
  appUrl: string | null
  createdAt: Date
  // false: mensagem informativa, sem botão "Assumir" (ex: mensagem de teste)
  claimable?: boolean
}

export function buildHandoffMessage(input: HandoffMessageInput): { text: string; blocks: Block[] } {
  const mention = mentionToken(input.mention)
  const title = truncate(input.title.trim() || 'Atendimento humano solicitado', HEADER_MAX)
  const message = escapeSlackText(input.message.trim())
  const contact = [input.contactName?.trim(), input.contactPhone?.trim()].filter(Boolean).join(' · ')

  const fields: Block[] = [
    { type: 'mrkdwn', text: `*Contato*\n${escapeSlackText(contact || 'Não identificado')}` },
    { type: 'mrkdwn', text: `*Conta WhatsApp*\n${escapeSlackText(input.instanceName)}` },
    { type: 'mrkdwn', text: `*Origem*\n${escapeSlackText(truncate(input.originLabel, FIELD_MAX))}` },
  ]

  const actionElements: Block[] = []
  if (input.claimable !== false) {
    actionElements.push({
      type: 'button',
      action_id: SLACK_CLAIM_ACTION_ID,
      text: { type: 'plain_text', text: 'Assumir atendimento', emoji: true },
      style: 'primary',
      value: input.slackMessageId,
    })
  }
  if (input.appUrl) {
    actionElements.push({
      type: 'button',
      action_id: SLACK_OPEN_ACTION_ID,
      text: { type: 'plain_text', text: 'Abrir FlashFlow', emoji: true },
      url: input.appUrl,
    })
  }

  const blocks: Block[] = [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
  ]
  const sectionText = [mention, message].filter(Boolean).join(' ')
  if (sectionText) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(sectionText, SECTION_MAX) } })
  }
  blocks.push({ type: 'section', fields })
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `FlashFlow · ${slackDate(input.createdAt)}` }],
  })
  if (actionElements.length > 0) {
    blocks.push({ type: 'actions', block_id: ACTIONS_BLOCK_ID, elements: actionElements })
  }

  // Fallback em texto: é o que aparece na notificação push/desktop do Slack.
  const fallback = [mention, `${title}${contact ? ` — ${contact}` : ''}`].filter(Boolean).join(' ')
  return { text: truncate(fallback, SECTION_MAX), blocks }
}

// Depois do clique em "Assumir": tira o botão (o link "Abrir FlashFlow"
// continua) e registra quem assumiu e quando.
export function buildClaimedBlocks(originalBlocks: unknown[], claimerSlackUserId: string, claimedAt: Date): Block[] {
  const blocks: Block[] = []
  for (const raw of originalBlocks) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Block
    if (block.block_id === ACTIONS_BLOCK_ID && Array.isArray(block.elements)) {
      const remaining = (block.elements as Block[]).filter((element) => element.action_id !== SLACK_CLAIM_ACTION_ID)
      if (remaining.length > 0) blocks.push({ ...block, elements: remaining })
      continue
    }
    blocks.push(block)
  }
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `:white_check_mark: Assumido por <@${claimerSlackUserId}> · ${slackDate(claimedAt)}`,
    }],
  })
  return blocks
}

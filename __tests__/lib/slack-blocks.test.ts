import {
  buildClaimedBlocks,
  buildHandoffMessage,
  escapeSlackText,
  SLACK_CLAIM_ACTION_ID,
  SLACK_OPEN_ACTION_ID,
} from '@/lib/slack-blocks'

type Block = { type: string; block_id?: string; text?: { text: string }; fields?: Array<{ text: string }>; elements?: Array<Record<string, unknown>> }

function baseInput(overrides: Partial<Parameters<typeof buildHandoffMessage>[0]> = {}) {
  return {
    slackMessageId: '11111111-2222-3333-4444-555555555555',
    title: 'Atendimento humano solicitado',
    message: 'Cliente quer falar com um atendente',
    mention: 'here' as const,
    instanceName: 'wa-1',
    originLabel: 'Fluxo "Confirmação"',
    contactName: 'Maria <!channel>',
    contactPhone: '351900000000',
    appUrl: 'https://app.example/',
    createdAt: new Date('2026-10-06T12:00:00Z'),
    ...overrides,
  }
}

describe('slack blocks', () => {
  it('escapes customer-controlled text so it can never trigger a Slack mention', () => {
    expect(escapeSlackText('<!channel> & <@U1>')).toBe('&lt;!channel&gt; &amp; &lt;@U1&gt;')
    const { blocks } = buildHandoffMessage(baseInput())
    const fields = (blocks as Block[]).find((block) => block.fields)?.fields ?? []
    expect(fields[0].text).toContain('Maria &lt;!channel&gt;')
    expect(JSON.stringify(blocks)).not.toContain('Maria <!channel>')
  })

  it('puts the configured mention in the message and the fallback text', () => {
    const { text, blocks } = buildHandoffMessage(baseInput())
    expect(text.startsWith('<!here>')).toBe(true)
    const section = (blocks as Block[]).find((block) => block.type === 'section' && block.text)
    expect(section?.text?.text).toBe('<!here> Cliente quer falar com um atendente')
  })

  it('adds the claim button carrying the slack message id, plus the link to FlashFlow', () => {
    const { blocks } = buildHandoffMessage(baseInput({ mention: 'none' }))
    const actions = (blocks as Block[]).find((block) => block.type === 'actions')
    expect(actions?.elements).toEqual([
      expect.objectContaining({ action_id: SLACK_CLAIM_ACTION_ID, value: '11111111-2222-3333-4444-555555555555', style: 'primary' }),
      expect.objectContaining({ action_id: SLACK_OPEN_ACTION_ID, url: 'https://app.example/' }),
    ])
  })

  it('omits the claim button for informational messages', () => {
    const { blocks } = buildHandoffMessage(baseInput({ claimable: false, appUrl: null }))
    expect((blocks as Block[]).some((block) => block.type === 'actions')).toBe(false)
  })

  it('replaces the claim button with who claimed it, keeping the link button', () => {
    const { blocks } = buildHandoffMessage(baseInput())
    const claimed = buildClaimedBlocks(blocks, 'U123ABC', new Date('2026-10-06T12:05:00Z')) as Block[]
    const actions = claimed.find((block) => block.type === 'actions')
    expect(actions?.elements?.map((element) => element.action_id)).toEqual([SLACK_OPEN_ACTION_ID])
    const last = claimed[claimed.length - 1]
    expect(last.type).toBe('context')
    expect(JSON.stringify(last)).toContain('Assumido por <@U123ABC>')
  })
})

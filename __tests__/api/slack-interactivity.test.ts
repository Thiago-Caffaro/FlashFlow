import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const SECRET = 'signingsecret1234567890abcdef'

const mockClaimSlackMessage = jest.fn()
const mockApplySlackClaim = jest.fn()
jest.mock('@/lib/slack-notifications', () => ({
  claimSlackMessage: (...args: unknown[]) => mockClaimSlackMessage(...args),
  applySlackClaim: (...args: unknown[]) => mockApplySlackClaim(...args),
}))

const mockGetSlackSigningSecret = jest.fn()
jest.mock('@/lib/slack-settings', () => ({
  getSlackSigningSecret: () => mockGetSlackSigningSecret(),
  getSlackCredentials: async () => ({ botToken: 'xoxb-test', signingSecret: SECRET }),
}))

const mockSlackUpdateMessage = jest.fn()
const mockSlackRespond = jest.fn()
jest.mock('@/lib/slack-client', () => ({
  slackUpdateMessage: (...args: unknown[]) => mockSlackUpdateMessage(...args),
  slackRespond: (...args: unknown[]) => mockSlackRespond(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/webhook/slack/interactivity/route')

const SLACK_MESSAGE_ID = '11111111-2222-3333-4444-555555555555'

function interaction(overrides: Record<string, unknown> = {}) {
  return {
    type: 'block_actions',
    user: { id: 'U123ABC', username: 'ana', name: 'Ana' },
    channel: { id: 'C0123456' },
    message: {
      ts: '1760000000.000100',
      blocks: [{ type: 'actions', block_id: 'flashflow_actions', elements: [{ type: 'button', action_id: 'flashflow_claim', value: SLACK_MESSAGE_ID }] }],
    },
    actions: [{ action_id: 'flashflow_claim', value: SLACK_MESSAGE_ID }],
    response_url: 'https://hooks.slack.com/actions/T1/1/abc',
    ...overrides,
  }
}

function signedRequest(payload: unknown, options: { secret?: string; timestamp?: number } = {}) {
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const signature = `v0=${createHmac('sha256', options.secret ?? SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`
  return new NextRequest('http://localhost/api/webhook/slack/interactivity', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': signature,
    },
  })
}

async function flushBackgroundWork() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe('POST /api/webhook/slack/interactivity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSlackSigningSecret.mockResolvedValue(SECRET)
    mockApplySlackClaim.mockResolvedValue(undefined)
    mockSlackUpdateMessage.mockResolvedValue(undefined)
    mockSlackRespond.mockResolvedValue(undefined)
  })

  it('rejects a request not signed with our signing secret', async () => {
    const response = await POST(signedRequest(interaction(), { secret: 'someone-else' }))

    expect(response.status).toBe(401)
    expect(mockClaimSlackMessage).not.toHaveBeenCalled()
  })

  it('rejects a replayed request older than 5 minutes', async () => {
    const response = await POST(signedRequest(interaction(), { timestamp: Math.floor(Date.now() / 1000) - 600 }))
    expect(response.status).toBe(401)
  })

  it('records the claim, acks with 200 and replaces the button with who claimed it', async () => {
    const row = { id: SLACK_MESSAGE_ID, instance_name: 'wa-1', conversation_id: 'conv-1', notification_id: 'notif-1' }
    mockClaimSlackMessage.mockResolvedValue({ claimed: true, row })

    const response = await POST(signedRequest(interaction()))
    await flushBackgroundWork()

    expect(response.status).toBe(200)
    expect(mockClaimSlackMessage).toHaveBeenCalledWith(SLACK_MESSAGE_ID, { userId: 'U123ABC', name: 'Ana' })
    expect(mockApplySlackClaim).toHaveBeenCalledWith(row, 'Ana')
    const [token, update] = mockSlackUpdateMessage.mock.calls[0]
    expect(token).toBe('xoxb-test')
    expect(update).toMatchObject({ channel: 'C0123456', ts: '1760000000.000100' })
    expect(JSON.stringify(update.blocks)).not.toContain('flashflow_claim')
    expect(JSON.stringify(update.blocks)).toContain('Assumido por <@U123ABC>')
  })

  it('tells the second person (ephemeral) who already claimed it, without touching the message', async () => {
    mockClaimSlackMessage.mockResolvedValue({ claimed: false, row: { id: SLACK_MESSAGE_ID, claimed_by_name: 'Ana' } })

    const response = await POST(signedRequest(interaction({ user: { id: 'U999', name: 'Bruno' } })))
    await flushBackgroundWork()

    expect(response.status).toBe(200)
    expect(mockSlackUpdateMessage).not.toHaveBeenCalled()
    expect(mockSlackRespond).toHaveBeenCalledWith('https://hooks.slack.com/actions/T1/1/abc', expect.objectContaining({
      response_type: 'ephemeral',
      text: expect.stringContaining('Ana'),
    }))
  })

  it('just acks other interactions, like the "Abrir FlashFlow" link button', async () => {
    const response = await POST(signedRequest(interaction({ actions: [{ action_id: 'flashflow_open' }] })))

    expect(response.status).toBe(200)
    expect(mockClaimSlackMessage).not.toHaveBeenCalled()
  })

  it('returns 503 while no signing secret is configured', async () => {
    mockGetSlackSigningSecret.mockResolvedValue(null)
    const response = await POST(signedRequest(interaction()))
    expect(response.status).toBe(503)
  })
})

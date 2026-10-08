export {}

const mockFrom = jest.fn()
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mockFrom } }))

const mockGetSlackCredentials = jest.fn()
const mockGetInstanceSlackSettings = jest.fn()
jest.mock('@/lib/slack-settings', () => ({
  getSlackCredentials: (...args: unknown[]) => mockGetSlackCredentials(...args),
  getInstanceSlackSettings: (...args: unknown[]) => mockGetInstanceSlackSettings(...args),
  getAppBaseUrl: async () => 'https://app.example',
}))

const mockSlackPostMessage = jest.fn()
jest.mock('@/lib/slack-client', () => ({
  slackPostMessage: (...args: unknown[]) => mockSlackPostMessage(...args),
}))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result = { data: null, error: null }) {
  const calls = { inserted: [] as unknown[], updated: [] as unknown[] }
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'is', 'in']) chain[method] = jest.fn(() => chain)
  chain.insert = jest.fn((value: unknown) => { calls.inserted.push(value); return chain })
  chain.update = jest.fn((value: unknown) => { calls.updated.push(value); return chain })
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return { chain: chain as Record<string, jest.Mock>, calls }
}

function setQueues(queues: Record<string, ReturnType<typeof builder>[]>) {
  const pending = new Map(Object.entries(queues))
  mockFrom.mockImplementation((table: string) => {
    const queue = pending.get(table)
    if (!queue?.length) throw new Error(`Unexpected table ${table}`)
    return queue.shift()!.chain
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  applySlackClaim,
  claimSlackMessage,
  forwardNotificationToSlack,
  postSlackHandoff,
  SlackNotConfiguredError,
} = require('@/lib/slack-notifications')

const notification = {
  id: 'notif-1',
  instance_name: 'wa-1',
  title: 'Chat escalado',
  message: 'Maria precisa de atendimento humano.',
  conversation_id: 'conv-1',
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    instance_name: 'wa-1',
    channel_id: 'C0123456',
    channel_name: '#atendimento',
    mention: 'here',
    forward_ai_escalation: false,
    forward_flow_notify: false,
    forward_outside_window: false,
    ...overrides,
  }
}

describe('slack notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSlackCredentials.mockResolvedValue({ botToken: 'xoxb-test', signingSecret: 'secret' })
    mockSlackPostMessage.mockResolvedValue({ channel: 'C0123456', ts: '1760000000.000100' })
  })

  it('does not forward anything while the toggle for that kind is off (opt-in)', async () => {
    mockGetInstanceSlackSettings.mockResolvedValue(settings())

    await expect(forwardNotificationToSlack(notification, 'ai_escalation')).resolves.toBe(false)

    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockSlackPostMessage).not.toHaveBeenCalled()
  })

  it('forwards an enabled kind to the default channel and records the Slack message', async () => {
    mockGetInstanceSlackSettings.mockResolvedValue(settings({ forward_ai_escalation: true }))
    const inserted = builder({ data: { id: 'slack-msg-1' }, error: null })
    const recorded = builder()
    setQueues({
      slack_messages: [inserted, recorded],
      conversations: [builder({ data: { contact_name: 'Maria', contact_phone: '351900000000' }, error: null })],
    })

    await expect(forwardNotificationToSlack(notification, 'ai_escalation')).resolves.toBe(true)

    expect(inserted.calls.inserted[0]).toMatchObject({
      instance_name: 'wa-1',
      source: 'ai_escalation',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      channel_id: 'C0123456',
    })
    const [token, payload] = mockSlackPostMessage.mock.calls[0]
    expect(token).toBe('xoxb-test')
    expect(payload.channel).toBe('C0123456')
    expect(payload.text).toContain('<!here>')
    expect(JSON.stringify(payload.blocks)).toContain('slack-msg-1')
    expect(recorded.calls.updated[0]).toEqual({ channel_id: 'C0123456', message_ts: '1760000000.000100' })
  })

  it('never throws when Slack fails — records the error and returns false', async () => {
    mockGetInstanceSlackSettings.mockResolvedValue(settings({ forward_flow_notify: true }))
    mockSlackPostMessage.mockRejectedValue(new Error('Canal do Slack não encontrado'))
    const failed = builder()
    setQueues({
      slack_messages: [builder({ data: { id: 'slack-msg-1' }, error: null }), failed],
      conversations: [builder({ data: null, error: null })],
    })
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(forwardNotificationToSlack(notification, 'flow_notify')).resolves.toBe(false)

    expect(failed.calls.updated[0]).toEqual({ error: 'Canal do Slack não encontrado' })
    consoleError.mockRestore()
  })

  it('refuses to post while Slack is not connected', async () => {
    mockGetSlackCredentials.mockResolvedValue(null)

    await expect(postSlackHandoff({
      instanceName: 'wa-1', source: 'flow_node', title: 't', message: 'm', originLabel: 'Fluxo', channelId: 'C0123456', mention: 'none',
    })).rejects.toBeInstanceOf(SlackNotConfiguredError)
  })

  it('lets only the first click claim the handoff', async () => {
    const claimed = { id: 'slack-msg-1', instance_name: 'wa-1', conversation_id: 'conv-1', notification_id: 'notif-1', claimed_by_name: 'Ana' }
    const firstClaim = builder({ data: claimed, error: null })
    setQueues({ slack_messages: [firstClaim] })

    await expect(claimSlackMessage('slack-msg-1', { userId: 'U1', name: 'Ana' }))
      .resolves.toEqual({ claimed: true, row: claimed })
    expect(firstClaim.chain.is).toHaveBeenCalledWith('claimed_at', null)

    setQueues({
      slack_messages: [builder({ data: null, error: null }), builder({ data: claimed, error: null })],
    })
    await expect(claimSlackMessage('slack-msg-1', { userId: 'U2', name: 'Bruno' }))
      .resolves.toEqual({ claimed: false, row: claimed })
  })

  it('applies a claim in FlashFlow: notification read and AI paused for the conversation', async () => {
    const notificationUpdate = builder()
    const sessionUpdate = builder()
    setQueues({
      notifications: [notificationUpdate],
      conversations: [builder({ data: { instance_name: 'wa-1', wa_id: '351900000000@s.whatsapp.net' }, error: null })],
      ai_sessions: [sessionUpdate],
    })
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})

    await applySlackClaim({
      id: 'slack-msg-1', instance_name: 'wa-1', conversation_id: 'conv-1', notification_id: 'notif-1',
      claimed_by_slack_user_id: 'U1', claimed_by_name: 'Ana', claimed_at: '2026-10-06T12:00:00Z',
    }, 'Ana')

    expect(notificationUpdate.calls.updated[0]).toMatchObject({ read_at: expect.any(String) })
    expect(sessionUpdate.calls.updated[0]).toEqual({ requires_human: true, pending_messages: [] })
    expect(sessionUpdate.chain.eq).toHaveBeenCalledWith('remote_jid', '351900000000@s.whatsapp.net')
    consoleLog.mockRestore()
  })
})

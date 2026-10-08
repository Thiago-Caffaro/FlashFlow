/**
 * Testes do node "Slack — Atendimento humano" (slackNotify) e do
 * encaminhamento opcional das notificações do node "Notificar".
 */
export {}

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

jest.mock('@/lib/ai-crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))

const mockDispatchSendText = jest.fn()
jest.mock('@/lib/whatsapp-dispatch', () => ({
  dispatchSendTemplate: jest.fn(),
  dispatchSendText: (...args: unknown[]) => mockDispatchSendText(...args),
  dispatchSendImage: jest.fn(),
  dispatchSendButtons: jest.fn(),
  supportsNativeButtons: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/whatsapp-account-provider', () => ({ getAccountProvider: jest.fn().mockResolvedValue('evolution') }))

const mockPostSlackHandoff = jest.fn()
const mockForwardNotificationToSlack = jest.fn()
jest.mock('@/lib/slack-notifications', () => ({
  FORWARDABLE_NOTIFICATION_COLUMNS: 'id, instance_name, title, message, conversation_id',
  postSlackHandoff: (...args: unknown[]) => mockPostSlackHandoff(...args),
  forwardNotificationToSlack: (...args: unknown[]) => mockForwardNotificationToSlack(...args),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result = { data: null, error: null }) {
  const calls = { inserted: [] as unknown[], updated: [] as unknown[] }
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'is']) chain[method] = jest.fn(() => chain)
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.insert = jest.fn((value: unknown) => { calls.inserted.push(value); return chain })
  chain.update = jest.fn((value: unknown) => { calls.updated.push(value); return chain })
  chain.then = (resolve: (v: Result) => unknown, reject?: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { chain: chain as Record<string, jest.Mock>, calls }
}

function setQueues(queues: Record<string, ReturnType<typeof builder>[]>) {
  const pending = new Map(Object.entries(queues))
  supabaseMock.from.mockImplementation((table: string) => {
    const queue = pending.get(table)
    if (!queue?.length) throw new Error(`Unexpected table ${table}`)
    return queue.shift()!.chain
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeFlow } = require('@/lib/flow-engine')

function slackFlow(slackData: Record<string, unknown>) {
  return {
    name: 'Confirmação',
    ativo: true,
    json: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'slack', type: 'slackNotify', position: { x: 0, y: 0 }, data: { slackMessage: 'Cliente pediu um atendente', ...slackData } },
        { id: 'after', type: 'sendMessage', position: { x: 0, y: 0 }, data: { message: 'Depois do Slack' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'slack' },
        { id: 'e2', source: 'slack', target: 'after' },
      ],
    },
  }
}

const ctx = { instanceName: 'wa-1', remoteJid: '351900000000@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: 'quero falar com alguém' }

beforeEach(() => {
  jest.clearAllMocks()
  mockPostSlackHandoff.mockResolvedValue({ slackMessageId: 'slack-msg-1', channelId: 'C0123456', ts: '1.1' })
  mockDispatchSendText.mockResolvedValue({ waMessageId: 'wamid.1' })
})

describe('slackNotify node', () => {
  it('creates the internal notification, posts to Slack, pauses the AI and ends the flow (handoff)', async () => {
    const notifications = builder({ data: { id: 'notif-1' }, error: null })
    const aiSessions = builder()
    setQueues({
      flows: [builder({ data: slackFlow({ slackChannelId: 'C0123456', slackMention: 'here', slackTitle: 'Precisa de humano' }), error: null })],
      instance_ai_config: [builder()],
      notifications: [notifications],
      ai_sessions: [aiSessions],
    })

    await executeFlow('flow-1', ctx)

    expect(notifications.calls.inserted[0]).toMatchObject({
      instance_name: 'wa-1',
      type: 'escalation',
      title: 'Precisa de humano',
      message: 'Cliente pediu um atendente',
      conversation_id: 'conv-1',
      flow_node_id: 'slack',
    })
    expect(mockPostSlackHandoff).toHaveBeenCalledWith(expect.objectContaining({
      instanceName: 'wa-1',
      source: 'flow_node',
      channelId: 'C0123456',
      mention: 'here',
      notificationId: 'notif-1',
      conversationId: 'conv-1',
      originLabel: 'Fluxo "Confirmação"',
    }))
    expect(aiSessions.calls.updated[0]).toEqual({ requires_human: true, pending_messages: [] })
    // O node seguinte nunca roda: a conversa foi transferida para humano.
    expect(mockDispatchSendText).not.toHaveBeenCalled()
  })

  it('keeps the notification and records the reason when Slack fails, still handing off', async () => {
    mockPostSlackHandoff.mockRejectedValue(new Error('Slack não conectado'))
    const notifications = builder({ data: { id: 'notif-1' }, error: null })
    const notificationUpdate = builder()
    const aiSessions = builder()
    setQueues({
      flows: [builder({ data: slackFlow({}), error: null })],
      instance_ai_config: [builder()],
      notifications: [notifications, notificationUpdate],
      ai_sessions: [aiSessions],
    })
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    await executeFlow('flow-1', ctx)

    expect(notificationUpdate.calls.updated[0]).toEqual({
      message: 'Cliente pediu um atendente\n\n(Não foi possível avisar no Slack: Slack não conectado)',
    })
    expect(aiSessions.calls.updated).toHaveLength(1)
    consoleError.mockRestore()
  })

  it('continues to the next node when "Transferir para humano" is off', async () => {
    setQueues({
      flows: [builder({ data: slackFlow({ slackHandoff: false }), error: null })],
      instance_ai_config: [builder()],
      notifications: [builder({ data: { id: 'notif-1' }, error: null })],
      messages: [builder()],
      conversations: [builder()],
    })

    await executeFlow('flow-1', ctx)

    expect(mockPostSlackHandoff).toHaveBeenCalledWith(expect.objectContaining({ channelId: null, mention: null }))
    expect(mockDispatchSendText).toHaveBeenCalledWith('wa-1', ctx.remoteJid, 'Depois do Slack')
  })
})

describe('node "Notificar" — encaminhamento opcional ao Slack', () => {
  it('hands the created notification to the forwarding rules (which decide whether to post)', async () => {
    const created = { id: 'notif-2', instance_name: 'wa-1', title: 'Notificacao do fluxo', message: 'Olhar pedido', conversation_id: 'conv-1' }
    setQueues({
      flows: [builder({
        data: {
          ativo: true,
          json: {
            nodes: [
              { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
              { id: 'notify', type: 'notify', position: { x: 0, y: 0 }, data: { notificationMessage: 'Olhar pedido' } },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'notify' }],
          },
        },
        error: null,
      })],
      instance_ai_config: [builder()],
      notifications: [builder({ data: created, error: null })],
    })

    await executeFlow('flow-1', ctx)

    expect(mockForwardNotificationToSlack).toHaveBeenCalledWith(created, 'flow_notify')
    expect(mockPostSlackHandoff).not.toHaveBeenCalled()
  })
})

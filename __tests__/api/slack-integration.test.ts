import { NextRequest } from 'next/server'

jest.mock('@/lib/server-auth', () => ({ isAdminRequest: () => true }))

const mockSlackAuthTest = jest.fn()
jest.mock('@/lib/slack-client', () => {
  const actual = jest.requireActual('@/lib/slack-client')
  return {
    SlackApiError: actual.SlackApiError,
    slackAuthTest: (...args: unknown[]) => mockSlackAuthTest(...args),
  }
})

const mockGetSlackCredentials = jest.fn()
const mockSaveSlackCredentials = jest.fn()
const mockGetInstanceSlackSettings = jest.fn()
const mockSaveInstanceSlackSettings = jest.fn()
jest.mock('@/lib/slack-settings', () => {
  return {
    SLACK_INTERACTIVITY_PATH: '/api/webhook/slack/interactivity',
    isSlackMention: (value: unknown) => value === 'none' || value === 'here' || value === 'channel',
    getAppBaseUrl: async () => 'https://app.example',
    getSlackCredentials: () => mockGetSlackCredentials(),
    saveSlackCredentials: (...args: unknown[]) => mockSaveSlackCredentials(...args),
    deleteSlackCredentials: jest.fn(),
    getInstanceSlackSettings: (...args: unknown[]) => mockGetInstanceSlackSettings(...args),
    saveInstanceSlackSettings: (...args: unknown[]) => mockSaveInstanceSlackSettings(...args),
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const connection = require('@/app/api/integrations/slack/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const settingsRoute = require('@/app/api/integrations/slack/settings/route')

function jsonRequest(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Slack integration API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSlackAuthTest.mockResolvedValue({ teamId: 'T1', teamName: 'Minha Loja', botUserId: 'U1', botName: 'flashflow' })
    mockGetInstanceSlackSettings.mockResolvedValue({
      instance_name: 'wa-1', channel_id: null, channel_name: null, mention: 'none',
      forward_ai_escalation: false, forward_flow_notify: false, forward_outside_window: false,
    })
  })

  it('never returns the token or signing secret in the connection status', async () => {
    mockGetSlackCredentials.mockResolvedValue({ botToken: 'xoxb-secret-token-123', signingSecret: 'abcdef1234567890abcdef' })

    const response = await connection.GET(new NextRequest('http://localhost/api/integrations/slack'))
    const json = await response.json()

    expect(json.status).toMatchObject({
      connected: true,
      teamName: 'Minha Loja',
      hasSigningSecret: true,
      interactivityUrl: 'https://app.example/api/webhook/slack/interactivity',
    })
    expect(JSON.stringify(json)).not.toContain('xoxb-secret-token-123')
    expect(JSON.stringify(json)).not.toContain('abcdef1234567890abcdef')
  })

  it('rejects a token that is not a bot token before calling Slack', async () => {
    const response = await connection.PUT(jsonRequest('/api/integrations/slack', 'PUT', { botToken: 'xoxp-user-token-123456' }))

    expect(response.status).toBe(400)
    expect(mockSlackAuthTest).not.toHaveBeenCalled()
    expect(mockSaveSlackCredentials).not.toHaveBeenCalled()
  })

  it('validates the token on Slack (auth.test) before saving it', async () => {
    mockGetSlackCredentials.mockResolvedValue({ botToken: 'xoxb-1234567890-abcdef', signingSecret: null })

    const response = await connection.PUT(jsonRequest('/api/integrations/slack', 'PUT', {
      botToken: 'xoxb-1234567890-abcdef',
      signingSecret: 'abcdef1234567890abcdef1234567890',
    }))

    expect(response.status).toBe(200)
    expect(mockSlackAuthTest).toHaveBeenCalledWith('xoxb-1234567890-abcdef')
    expect(mockSaveSlackCredentials).toHaveBeenCalledWith({
      botToken: 'xoxb-1234567890-abcdef',
      signingSecret: 'abcdef1234567890abcdef1234567890',
    })
  })

  it('does not save a token Slack rejects', async () => {
    const { SlackApiError } = jest.requireActual('@/lib/slack-client')
    mockSlackAuthTest.mockRejectedValue(new SlackApiError('invalid_auth', 'Token do Slack inválido'))

    const response = await connection.PUT(jsonRequest('/api/integrations/slack', 'PUT', { botToken: 'xoxb-1234567890-wrong' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBe('Token do Slack inválido')
    expect(mockSaveSlackCredentials).not.toHaveBeenCalled()
  })

  it('refuses to enable a forwarding rule without a default channel', async () => {
    const response = await settingsRoute.PUT(jsonRequest('/api/integrations/slack/settings', 'PUT', {
      instance: 'wa-1',
      forward_ai_escalation: true,
    }))

    expect(response.status).toBe(400)
    expect(mockSaveInstanceSlackSettings).not.toHaveBeenCalled()
  })

  it('saves only allowlisted, validated fields', async () => {
    mockSaveInstanceSlackSettings.mockResolvedValue({ instance_name: 'wa-1' })

    const invalid = await settingsRoute.PUT(jsonRequest('/api/integrations/slack/settings', 'PUT', {
      instance: 'wa-1', channel_id: 'not a channel',
    }))
    expect(invalid.status).toBe(400)

    await settingsRoute.PUT(jsonRequest('/api/integrations/slack/settings', 'PUT', {
      instance: 'wa-1', channel_id: 'C0123456', channel_name: '#atendimento', forward_ai_escalation: true, instance_name: 'wa-other',
    }))
    expect(mockSaveInstanceSlackSettings).toHaveBeenCalledWith('wa-1', {
      channel_id: 'C0123456',
      channel_name: '#atendimento',
      forward_ai_escalation: true,
    })
  })
})

export {}

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SlackApiError, slackListChannels, slackPostMessage, slackRespond } = require('@/lib/slack-client')

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

describe('slack client', () => {
  beforeEach(() => jest.clearAllMocks())

  it('posts messages as JSON with the bot token as Bearer and without link unfurls', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, channel: 'C0123456', ts: '1760000000.000100' }))

    const result = await slackPostMessage('xoxb-test', { channel: 'C0123456', text: 'oi', blocks: [] })

    expect(result).toEqual({ channel: 'C0123456', ts: '1760000000.000100' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://slack.com/api/chat.postMessage')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer xoxb-test')
    expect(JSON.parse(init.body)).toMatchObject({ channel: 'C0123456', unfurl_links: false })
  })

  it('turns an ok:false response into an actionable error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'not_in_channel' }))

    const attempt = slackPostMessage('xoxb-test', { channel: 'G0123456', text: 'oi' })
    await expect(attempt).rejects.toBeInstanceOf(SlackApiError)
    await expect(attempt).rejects.toThrow('/invite')
  })

  it('reports rate limiting with Retry-After', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '30' }))

    await expect(slackPostMessage('xoxb-test', { channel: 'C0123456', text: 'oi' }))
      .rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 30 })
  })

  it('follows conversations.list pagination and sorts channels by name', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        channels: [{ id: 'C2', name: 'vendas', is_private: false, is_member: true }],
        response_metadata: { next_cursor: 'abc' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        channels: [{ id: 'G1', name: 'atendimento', is_private: true, is_member: true }],
        response_metadata: { next_cursor: '' },
      }))

    const channels = await slackListChannels('xoxb-test')

    expect(channels.map((channel: { name: string }) => channel.name)).toEqual(['atendimento', 'vendas'])
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=abc')
    expect(String(fetchMock.mock.calls[0][0])).toContain('types=public_channel&')
  })

  it('only answers response_url on the official Slack host', async () => {
    await expect(slackRespond('https://evil.example/hook', { text: 'x' })).rejects.toThrow('response_url')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

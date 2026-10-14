export {}

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openAITokenLimit, postOpenAIChat } = require('@/lib/openai-chat')

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('openai-chat', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses max_completion_tokens, never the deprecated max_tokens', () => {
    expect(openAITokenLimit(300)).toEqual({ max_completion_tokens: 300 })
    expect(openAITokenLimit(undefined)).toEqual({})
  })

  it('retries once without temperature when the model only accepts the default', async () => {
    fetchMock
      .mockResolvedValueOnce(response(400, { error: { message: "Unsupported value: 'temperature' does not support 0.7", param: 'temperature' } }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: 'oi' } }] }))

    const result = await postOpenAIChat('sk-test', { model: 'gpt-6-luna', messages: [], temperature: 0.7, max_completion_tokens: 50 })

    expect(result.ok).toBe(true)
    expect(result.data.choices[0].message.content).toBe('oi')
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(retryBody).not.toHaveProperty('temperature')
    expect(retryBody.max_completion_tokens).toBe(50)
  })

  it('does not retry other errors', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: { message: 'Incorrect API key' } }))

    const result = await postOpenAIChat('sk-test', { model: 'gpt-4o', messages: [], temperature: 0.7 })

    expect(result.ok).toBe(false)
    expect(result.data.error.message).toBe('Incorrect API key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

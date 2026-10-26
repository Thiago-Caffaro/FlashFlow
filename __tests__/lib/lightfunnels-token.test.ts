const mockLoadIntegration = jest.fn()
const mockUpdateResult = jest.fn()
const mockUpdatePatch = jest.fn()
const mockUpdateFilters = jest.fn()

jest.mock('@/lib/ai-crypto', () => ({
  decryptSecret: jest.fn((value: string) => `plain:${value}`),
  encryptSecret: jest.fn((value: string) => ({ encrypted_key: `enc:${value}`, iv: `iv:${value}`, auth_tag: 'tag' })),
}))

jest.mock('@/lib/app-settings', () => ({
  getSetting: jest.fn(async (key: string) => (key === 'lightfunnels_client_id' ? 'cid' : key === 'lightfunnels_client_secret' ? 'csecret' : null)),
}))

jest.mock('@/lib/lightfunnels-integration-store', () => {
  const actual = jest.requireActual('@/lib/lightfunnels-integration-store')
  return {
    ...actual,
    loadLightfunnelsIntegration: mockLoadIntegration,
  }
})

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => {
      const builder: Record<string, unknown> = {}
      builder.update = (patch: unknown) => { mockUpdatePatch(patch); return builder }
      builder.eq = (column: string, value: unknown) => { mockUpdateFilters(column, value); return builder }
      builder.select = () => builder
      builder.maybeSingle = () => mockUpdateResult()
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
      return builder
    }),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getValidAccessToken, LightfunnelsAuthError } = require('@/lib/lightfunnels-token')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    oauth_connected: true,
    encrypted_access_token: 'access-old',
    access_token_iv: 'iv',
    access_token_auth_tag: 'tag',
    access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    encrypted_refresh_token: 'refresh-old',
    refresh_token_iv: 'refresh-iv-old',
    refresh_token_auth_tag: 'tag',
    ...overrides,
  }
}

const expiredRow = () => row({ access_token_expires_at: new Date(Date.now() + 60 * 1000).toISOString() })

describe('getValidAccessToken', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock as unknown as typeof fetch
    mockUpdateResult.mockResolvedValue({ data: { id: 'int-1' }, error: null })
  })

  it('returns the stored token while it is fresh, without calling the API', async () => {
    await expect(getValidAccessToken(row())).resolves.toBe('plain:access-old')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes near expiry and saves the rotated tokens with an optimistic lock', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'app_v3_new', refresh_token: 'rt_new', expires_in: 7199 }),
    })
    await expect(getValidAccessToken(expiredRow())).resolves.toBe('app_v3_new')
    const body = String(fetchMock.mock.calls[0][1].body)
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=plain%3Arefresh-old')
    expect(mockUpdatePatch).toHaveBeenCalledWith(expect.objectContaining({
      encrypted_access_token: 'enc:app_v3_new',
      encrypted_refresh_token: 'enc:rt_new',
    }))
    expect(mockUpdateFilters).toHaveBeenCalledWith('refresh_token_iv', 'refresh-iv-old')
  })

  it('uses the token saved by a concurrent refresh when ours was already rotated', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant' }) })
    mockLoadIntegration.mockResolvedValue(row({ encrypted_access_token: 'access-from-other', refresh_token_iv: 'refresh-iv-new' }))
    await expect(getValidAccessToken(expiredRow())).resolves.toBe('plain:access-from-other')
    expect(mockUpdatePatch).not.toHaveBeenCalledWith(expect.objectContaining({ oauth_connected: false }))
  })

  it('marks the integration disconnected when the refresh token is rejected', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant' }) })
    mockLoadIntegration.mockResolvedValue(expiredRow())
    await expect(getValidAccessToken(expiredRow())).rejects.toBeInstanceOf(LightfunnelsAuthError)
    expect(mockUpdatePatch).toHaveBeenCalledWith(expect.objectContaining({ oauth_connected: false }))
  })

  it('refuses to use a disconnected integration', async () => {
    await expect(getValidAccessToken(row({ oauth_connected: false }))).rejects.toThrow('desconectada')
  })
})

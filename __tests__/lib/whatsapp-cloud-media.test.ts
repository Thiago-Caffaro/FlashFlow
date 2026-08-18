/**
 * Testes para lib/whatsapp-cloud-media.ts — resolução de mídia recebida da
 * Cloud API (media_id -> metadados -> bytes -> Supabase Storage), o
 * equivalente de downloadAndStoreMedia do webhook Evolution, só que em duas
 * chamadas HTTP autenticadas em vez de uma via Evolution API.
 */
export {}

const mockFetchCloudApi = jest.fn()
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  fetchCloudApi: (...args: unknown[]) => mockFetchCloudApi(...args),
}))

const mockStoreMediaBuffer = jest.fn()
jest.mock('@/lib/media-storage', () => ({
  storeMediaBuffer: (...args: unknown[]) => mockStoreMediaBuffer(...args),
}))

const mockDecodeCloudAccessToken = jest.fn()
jest.mock('@/lib/whatsapp-cloud-credentials', () => ({
  decodeCloudAccessToken: (...args: unknown[]) => mockDecodeCloudAccessToken(...args),
}))

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAndStoreCloudMedia } = require('@/lib/whatsapp-cloud-media')

const credentials = {
  instance_name: 'wa-1',
  encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag',
}

function bytesResponse(ok: boolean, byteLength = 100) {
  return {
    ok,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(byteLength)),
  }
}

describe('resolveAndStoreCloudMedia', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
  })

  it('resolves metadata, downloads bytes, and stores via media-storage', async () => {
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      body: { url: 'https://lookaside.fbsbx.com/temp/abc', mime_type: 'image/jpeg', file_size: 1000 },
      text: '{}',
    })
    fetchMock.mockResolvedValue(bytesResponse(true, 1000))
    mockStoreMediaBuffer.mockResolvedValue('https://supabase.example/media/abc.jpg')

    const result = await resolveAndStoreCloudMedia('media-id-1', credentials)

    expect(mockFetchCloudApi).toHaveBeenCalledWith('/media-id-1', 'plain-token', { method: 'GET' }, 10_000)
    expect(fetchMock).toHaveBeenCalledWith('https://lookaside.fbsbx.com/temp/abc', {
      headers: { Authorization: 'Bearer plain-token' },
      signal: expect.anything(),
    })
    expect(mockStoreMediaBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', 'media-id-1')
    expect(result).toBe('https://supabase.example/media/abc.jpg')
  })

  it('returns null when the metadata lookup fails', async () => {
    mockFetchCloudApi.mockResolvedValue({ ok: false, status: 404, body: null, text: 'not found' })

    const result = await resolveAndStoreCloudMedia('media-id-1', credentials)

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when metadata reports a file larger than the size cap', async () => {
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      body: { url: 'https://lookaside.fbsbx.com/temp/abc', mime_type: 'image/jpeg', file_size: 10 * 1024 * 1024 },
      text: '{}',
    })

    const result = await resolveAndStoreCloudMedia('media-id-1', credentials)

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when the byte download fails', async () => {
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      body: { url: 'https://lookaside.fbsbx.com/temp/abc', mime_type: 'image/jpeg', file_size: 1000 },
      text: '{}',
    })
    fetchMock.mockResolvedValue(bytesResponse(false))

    const result = await resolveAndStoreCloudMedia('media-id-1', credentials)

    expect(result).toBeNull()
    expect(mockStoreMediaBuffer).not.toHaveBeenCalled()
  })

  it('returns null instead of throwing when an exception happens mid-flow', async () => {
    mockFetchCloudApi.mockRejectedValue(new Error('network down'))

    const result = await resolveAndStoreCloudMedia('media-id-1', credentials)

    expect(result).toBeNull()
  })
})

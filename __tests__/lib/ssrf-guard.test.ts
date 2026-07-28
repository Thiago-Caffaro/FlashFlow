import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

const mockDnsLookup = jest.fn()
const mockHttpsRequest = jest.fn()

jest.mock('node:dns', () => ({
  promises: { lookup: (...args: unknown[]) => mockDnsLookup(...args) },
}))

jest.mock('node:https', () => ({
  request: (...args: unknown[]) => mockHttpsRequest(...args),
}))

import { fetchImageSafely, isUrlSafeForOutboundFetch } from '@/lib/ssrf-guard'

type MockResponse = Readable & {
  statusCode: number
  headers: Record<string, string>
}

type MockRequest = EventEmitter & {
  setTimeout: jest.Mock
  destroy: jest.Mock
  end: jest.Mock
}

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
])
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

function queueHttpsResponse({
  status = 200,
  headers = {},
  body = Buffer.alloc(0),
}: {
  status?: number
  headers?: Record<string, string>
  body?: Buffer
}) {
  mockHttpsRequest.mockImplementationOnce((
    _options: Record<string, unknown>,
    onResponse: (response: MockResponse) => void
  ) => {
    const request = new EventEmitter() as MockRequest
    request.setTimeout = jest.fn()
    request.destroy = jest.fn((error?: Error) => {
      if (error) request.emit('error', error)
    })
    request.end = jest.fn(() => {
      const response = Readable.from(body.length ? [body] : []) as MockResponse
      response.statusCode = status
      response.headers = headers
      onResponse(response)
    })
    return request
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('isUrlSafeForOutboundFetch', () => {
  it('rejects non-HTTPS and malformed URLs', async () => {
    expect(await isUrlSafeForOutboundFetch('http://example.com/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('ftp://example.com/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('file:///etc/passwd')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('not-a-url')).toBe(false)
  })

  it('rejects blocked hostnames and private or reserved literal IPs', async () => {
    expect(await isUrlSafeForOutboundFetch('https://localhost/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://127.0.0.1/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://10.0.0.5/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://100.64.0.1/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://192.0.2.1/x.jpg')).toBe(false)
  })

  it('accepts a public literal IP without DNS', async () => {
    expect(await isUrlSafeForOutboundFetch('https://8.8.8.8/x.jpg')).toBe(true)
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('rejects any hostname resolution containing a private IP', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    expect(await isUrlSafeForOutboundFetch('https://mixed.example.com/x.jpg')).toBe(false)
  })

  it('accepts a hostname only when every resolved address is public', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await isUrlSafeForOutboundFetch('https://cdn.example.com/x.jpg')).toBe(true)
  })

  it('rejects DNS failures', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await isUrlSafeForOutboundFetch('https://missing.invalid/x.jpg')).toBe(false)
  })
})

describe('fetchImageSafely', () => {
  it('pins the HTTPS connection to the validated IP and preserves SNI and Host', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueHttpsResponse({
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(JPEG_BYTES.length),
      },
      body: JPEG_BYTES,
    })

    const result = await fetchImageSafely('https://cdn.example.com/x.jpg')

    expect(result.ok).toBe(true)
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1)
    expect(mockHttpsRequest.mock.calls[0][0]).toMatchObject({
      hostname: '93.184.216.34',
      servername: 'cdn.example.com',
      headers: { Host: 'cdn.example.com' },
    })
    if (result.ok) {
      expect(result.contentType).toBe('image/jpeg')
      expect(result.buffer).toEqual(JPEG_BYTES)
    }
  })

  it('does not open a request when the URL fails SSRF validation', async () => {
    const result = await fetchImageSafely('https://127.0.0.1/x.jpg')
    expect(result.ok).toBe(false)
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('revalidates and pins every redirect target', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueHttpsResponse({
      status: 302,
      headers: { location: 'https://cdn2.example.com/y.png' },
    })
    queueHttpsResponse({
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    })

    const result = await fetchImageSafely('https://cdn.example.com/x.jpg')

    expect(result.ok).toBe(true)
    expect(mockDnsLookup).toHaveBeenCalledTimes(2)
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2)
  })

  it('rejects a redirect to a private address before the second request', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueHttpsResponse({
      status: 302,
      headers: { location: 'https://169.254.169.254/latest/meta-data' },
    })

    const result = await fetchImageSafely('https://cdn.example.com/x.jpg')

    expect(result.ok).toBe(false)
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects non-image content types and invalid image bytes', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueHttpsResponse({
      headers: { 'content-type': 'text/html' },
      body: Buffer.from('<html>'),
    })
    await expect(fetchImageSafely('https://cdn.example.com/x.jpg')).resolves.toMatchObject({ ok: false })

    queueHttpsResponse({
      headers: { 'content-type': 'image/svg+xml' },
      body: Buffer.from('<svg></svg>'),
    })
    await expect(fetchImageSafely('https://cdn.example.com/x.svg')).resolves.toEqual({
      ok: false,
      reason: 'invalid_image_bytes',
    })
  })

  it('rejects a declared body larger than the configured limit', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueHttpsResponse({
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(50 * 1024 * 1024),
      },
      body: JPEG_BYTES,
    })

    const result = await fetchImageSafely('https://cdn.example.com/x.jpg', { maxBytes: 1_024 })
    expect(result).toEqual({ ok: false, reason: 'too_large' })
  })
})

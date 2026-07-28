/**
 * Testes para lib/ssrf-guard.ts (P10 da varredura de segurança).
 */

const dnsLookupMock = jest.fn()
jest.mock('node:dns', () => ({
  promises: { lookup: (...args: unknown[]) => dnsLookupMock(...args) },
}))

import { fetchImageSafely, isUrlSafeForOutboundFetch } from '@/lib/ssrf-guard'

const fetchMock = jest.fn()
global.fetch = fetchMock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('isUrlSafeForOutboundFetch', () => {
  it('rejeita URLs que não sejam https', async () => {
    expect(await isUrlSafeForOutboundFetch('http://example.com/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('ftp://example.com/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('file:///etc/passwd')).toBe(false)
  })

  it('rejeita URL malformada', async () => {
    expect(await isUrlSafeForOutboundFetch('não-e-uma-url')).toBe(false)
  })

  it('rejeita hostnames literais bloqueados', async () => {
    expect(await isUrlSafeForOutboundFetch('https://localhost/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://0.0.0.0/x.jpg')).toBe(false)
  })

  it('rejeita IP literal privado/loopback na própria URL', async () => {
    expect(await isUrlSafeForOutboundFetch('https://127.0.0.1/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://10.0.0.5/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://192.168.1.1/x.jpg')).toBe(false)
    expect(await isUrlSafeForOutboundFetch('https://169.254.169.254/latest/meta-data')).toBe(false)
  })

  it('rejeita IP literal público (sem precisar de DNS)', async () => {
    expect(await isUrlSafeForOutboundFetch('https://8.8.8.8/x.jpg')).toBe(true)
  })

  it('rejeita hostname que resolve para IP privado (proteção contra DNS rebinding)', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    expect(await isUrlSafeForOutboundFetch('https://interno.exemplo.com/x.jpg')).toBe(false)
  })

  it('aceita hostname que resolve para IP público', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await isUrlSafeForOutboundFetch('https://cdn.exemplo.com/x.jpg')).toBe(true)
  })

  it('rejeita quando qualquer um dos IPs resolvidos é privado', async () => {
    dnsLookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    expect(await isUrlSafeForOutboundFetch('https://misto.exemplo.com/x.jpg')).toBe(false)
  })

  it('rejeita quando a resolução DNS falha', async () => {
    dnsLookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await isUrlSafeForOutboundFetch('https://nao-existe.invalido/x.jpg')).toBe(false)
  })
})

describe('fetchImageSafely', () => {
  it('retorna a imagem quando tudo é válido', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/jpeg' : name === 'content-length' ? '4' : null),
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    })

    const result = await fetchImageSafely('https://cdn.exemplo.com/x.jpg')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contentType).toBe('image/jpeg')
      expect(result.buffer.length).toBe(4)
    }
  })

  it('rejeita quando a URL não passa na validação SSRF (não chega a chamar fetch)', async () => {
    const result = await fetchImageSafely('https://127.0.0.1/x.jpg')
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('segue um redirect válido e revalida a nova URL', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: { get: (n: string) => (n === 'location' ? 'https://cdn2.exemplo.com/y.jpg' : null) },
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: (n: string) => (n === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => new Uint8Array([9]).buffer,
      })

    const result = await fetchImageSafely('https://cdn.exemplo.com/x.jpg')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejeita redirect para IP privado', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: { get: (n: string) => (n === 'location' ? 'https://169.254.169.254/latest/meta-data' : null) },
    })

    const result = await fetchImageSafely('https://cdn.exemplo.com/x.jpg')
    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejeita quando o Content-Type retornado não é de imagem', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (n: string) => (n === 'content-type' ? 'text/html' : null) },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })

    const result = await fetchImageSafely('https://cdn.exemplo.com/x.jpg')
    expect(result.ok).toBe(false)
  })

  it('rejeita corpo maior que o limite declarado no Content-Length', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: (n: string) => (n === 'content-type' ? 'image/jpeg' : n === 'content-length' ? String(50 * 1024 * 1024) : null),
      },
      arrayBuffer: async () => new ArrayBuffer(10),
    })

    const result = await fetchImageSafely('https://cdn.exemplo.com/x.jpg', { maxBytes: 1024 })
    expect(result.ok).toBe(false)
  })
})

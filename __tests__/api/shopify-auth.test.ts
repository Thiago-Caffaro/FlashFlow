/**
 * app/api/shopify/auth (POST) e o callback com app próprio da loja.
 */
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const mockGetSetting = jest.fn()
const mockLoadShopifyAppFieldsByDomain = jest.fn()
const mockUpsert = jest.fn()
const mockEnsureWebhooks = jest.fn()

jest.mock('@/lib/app-settings', () => ({ getSetting: mockGetSetting }))
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: (...args: unknown[]) => {
        mockUpsert(...args)
        return { select: async () => ({ data: [], error: null }) }
      },
    }),
  },
}))
jest.mock('@/lib/shopify-integration-store', () => {
  const actual = jest.requireActual('@/lib/shopify-integration-store')
  return { ...actual, loadShopifyAppFieldsByDomain: mockLoadShopifyAppFieldsByDomain }
})
jest.mock('@/lib/shopify-confirmation-service', () => ({ SHOPIFY_INTEGRATION_PUBLIC_SELECT: 'id' }))
jest.mock('@/lib/shopify-webhook-setup', () => ({ ensureOrderCreateWebhookRegisteredWithToken: mockEnsureWebhooks }))

const fetchMock = jest.fn()
global.fetch = fetchMock

process.env.AI_ENCRYPTION_KEY = 'a'.repeat(64)

// eslint-disable-next-line @typescript-eslint/no-require-imports
const auth = require('@/app/api/shopify/auth/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const callback = require('@/app/api/shopify/callback/route')

function authRequest(body: unknown) {
  return new NextRequest('http://localhost/api/shopify/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function settings(values: Record<string, string>) {
  mockGetSetting.mockImplementation(async (key: string) => values[key] ?? null)
}

function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? ''
  const match = /shopify_oauth_state=([^;]+)/.exec(header)
  return match ? decodeURIComponent(match[1]) : ''
}

function signedCallback(shop: string, state: string, secret: string, cookie: string) {
  const params: Record<string, string> = { code: 'code-1', shop, state, timestamp: '1700000000' }
  const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  const hmac = createHmac('sha256', secret).update(message).digest('hex')
  const req = new NextRequest(`http://localhost/api/shopify/callback?${new URLSearchParams({ ...params, hmac }).toString()}`)
  req.cookies.set('shopify_oauth_state', cookie)
  return req
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.SHOPIFY_CLIENT_ID
  delete process.env.SHOPIFY_CLIENT_SECRET
  settings({ shopify_client_id: 'global-id', shopify_client_secret: 'global-secret', shopify_app_base_url: 'https://app.example.com' })
  mockLoadShopifyAppFieldsByDomain.mockResolvedValue(null)
  mockEnsureWebhooks.mockResolvedValue({ ok: true })
})

describe('POST /api/shopify/auth', () => {
  it('uses the global app when no store app is given', async () => {
    const res = await auth.POST(authRequest({ shop: 'loja.myshopify.com', country: 'spain' }))
    const json = await res.json()

    expect(json.ok).toBe(true)
    const url = new URL(json.authUrl)
    expect(url.host).toBe('loja.myshopify.com')
    expect(url.searchParams.get('client_id')).toBe('global-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/shopify/callback')
    // O segredo nunca vai na URL.
    expect(json.authUrl).not.toContain('secret')
  })

  it('uses the store app and keeps its secret only in the encrypted cookie', async () => {
    const res = await auth.POST(authRequest({ shop: 'loja.myshopify.com', country: 'ES', clientId: 'store-id', clientSecret: 'store-secret' }))
    const json = await res.json()

    expect(new URL(json.authUrl).searchParams.get('client_id')).toBe('store-id')
    const cookie = cookieFrom(res)
    expect(cookie).not.toBe('')
    expect(cookie).not.toContain('store-secret')
  })

  it('rejects a store app with only one of Client ID / Client Secret', async () => {
    const res = await auth.POST(authRequest({ shop: 'loja.myshopify.com', country: 'ES', clientId: 'store-id' }))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid shop domain', async () => {
    const res = await auth.POST(authRequest({ shop: 'evil.com', country: 'ES' }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/shopify/callback with a store app', () => {
  it('verifies the HMAC with the store secret and saves the store app encrypted', async () => {
    const start = await auth.POST(authRequest({ shop: 'loja.myshopify.com', country: 'ES', clientId: 'store-id', clientSecret: 'store-secret' }))
    const { authUrl } = await start.json()
    const state = new URL(authUrl).searchParams.get('state') ?? ''
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'shpat_x' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shop: { name: 'Loja' } }) })

    const res = await callback.GET(signedCallback('loja.myshopify.com', state, 'store-secret', cookieFrom(start)))

    expect(res.headers.get('location')).toContain('shopifyConnected=1')
    const tokenBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(tokenBody).toMatchObject({ client_id: 'store-id', client_secret: 'store-secret' })
    const saved = mockUpsert.mock.calls[0][0]
    expect(saved).toMatchObject({ shop_domain: 'loja.myshopify.com', default_country: 'ES', app_client_id: 'store-id' })
    expect(saved.encrypted_app_client_secret).toBeTruthy()
    expect(saved.encrypted_app_client_secret).not.toContain('store-secret')
  })

  it('rejects a callback signed with the global secret when the store app is in use', async () => {
    const start = await auth.POST(authRequest({ shop: 'loja.myshopify.com', country: 'ES', clientId: 'store-id', clientSecret: 'store-secret' }))
    const { authUrl } = await start.json()
    const state = new URL(authUrl).searchParams.get('state') ?? ''

    const res = await callback.GET(signedCallback('loja.myshopify.com', state, 'global-secret', cookieFrom(start)))

    expect(res.headers.get('location')).toContain('shopifyError')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

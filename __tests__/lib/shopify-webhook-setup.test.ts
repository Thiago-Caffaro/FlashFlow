export {}

const mockGetSetting = jest.fn()
const mockListWebhooks = jest.fn()
const mockCreateWebhook = jest.fn()

jest.mock('@/lib/app-settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

jest.mock('@/lib/shopify-client', () => ({
  ShopifyClient: jest.fn().mockImplementation(() => ({
    listWebhooks: mockListWebhooks,
    createWebhook: mockCreateWebhook,
  })),
}))

jest.mock('@/lib/shopify-integration-store', () => ({
  shopifyClientFromIntegration: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureOrderCreateWebhookRegisteredWithToken } = require('@/lib/shopify-webhook-setup')

describe('shopify webhook setup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSetting.mockResolvedValue('https://app.example/')
    mockListWebhooks.mockResolvedValue({ webhooks: [] })
    mockCreateWebhook.mockResolvedValue({ webhook: { id: 1 } })
  })

  it('registers checkout topics on the abandoned-checkouts route next to the order topics', async () => {
    const result = await ensureOrderCreateWebhookRegisteredWithToken('loja.myshopify.com', 'token')

    expect(result).toMatchObject({ ok: true, alreadyRegistered: false })
    expect(mockCreateWebhook).toHaveBeenCalledWith('orders/create', 'https://app.example/api/webhook/shopify/orders')
    expect(mockCreateWebhook).toHaveBeenCalledWith('checkouts/create', 'https://app.example/api/webhook/shopify/abandoned-checkouts')
    expect(mockCreateWebhook).toHaveBeenCalledWith('checkouts/update', 'https://app.example/api/webhook/shopify/abandoned-checkouts')
  })

  it('only creates the subscriptions missing for our address (existing stores gain the checkout topics)', async () => {
    mockListWebhooks.mockImplementation(async ({ topic }: { topic: string }) => ({
      webhooks: topic.startsWith('orders/')
        ? [{ id: 1, topic, address: 'https://app.example/api/webhook/shopify/orders' }]
        : [],
    }))

    await ensureOrderCreateWebhookRegisteredWithToken('loja.myshopify.com', 'token')

    expect(mockCreateWebhook.mock.calls.map(([topic]) => topic)).toEqual([
      'checkouts/create',
      'checkouts/update',
      'draft_orders/create',
      'draft_orders/update',
      'draft_orders/delete',
    ])
  })

  it('registers the draft order topics on their own route', async () => {
    await ensureOrderCreateWebhookRegisteredWithToken('loja.myshopify.com', 'token')

    expect(mockCreateWebhook).toHaveBeenCalledWith('draft_orders/create', 'https://app.example/api/webhook/shopify/draft-orders')
    expect(mockCreateWebhook).toHaveBeenCalledWith('draft_orders/delete', 'https://app.example/api/webhook/shopify/draft-orders')
  })

  it('keeps registering the other topics when the store did not grant draft orders, and says how to fix it', async () => {
    mockCreateWebhook.mockImplementation(async (topic: string) => {
      if (topic.startsWith('draft_orders/')) throw new Error('Shopify API 403: This action requires merchant approval for read_draft_orders scope.')
      return { webhook: { id: 1 } }
    })

    const result = await ensureOrderCreateWebhookRegisteredWithToken('loja.myshopify.com', 'token')

    expect(mockCreateWebhook).toHaveBeenCalledWith('checkouts/update', expect.any(String))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('read_draft_orders')
    expect(result.error).toContain('reconecte a loja')
  })
})

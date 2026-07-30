export {}

const mockGetSetting = jest.fn()
const mockSetSetting = jest.fn()

jest.mock('@/lib/app-settings', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  getShopifyTriggersEnabled,
  setShopifyTriggersEnabled,
} = require('@/lib/shopify-trigger-settings')

describe('Shopify trigger settings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('is enabled by default when no setting has been saved', async () => {
    mockGetSetting.mockResolvedValue(null)
    await expect(getShopifyTriggersEnabled()).resolves.toBe(true)
  })

  it('reads the persisted disabled state', async () => {
    mockGetSetting.mockResolvedValue('false')
    await expect(getShopifyTriggersEnabled()).resolves.toBe(false)
  })

  it('persists both switch states', async () => {
    await setShopifyTriggersEnabled(false)
    await setShopifyTriggersEnabled(true)
    expect(mockSetSetting).toHaveBeenNthCalledWith(1, 'shopify_triggers_enabled', 'false')
    expect(mockSetSetting).toHaveBeenNthCalledWith(2, 'shopify_triggers_enabled', 'true')
  })
})

export {}

const getSettingMock = jest.fn()
const setSettingMock = jest.fn()
const deleteSettingMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/lib/app-settings', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
  deleteSetting: deleteSettingMock,
}))
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: fromMock },
}))

function accountQuery(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result)
  const eq = jest.fn(() => ({ maybeSingle }))
  const select = jest.fn(() => ({ eq }))
  fromMock.mockReturnValue({ select })
  return { eq }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultShopifyOrderInstance, setDefaultShopifyOrderInstance } = require('@/lib/shopify-order-settings')

describe('Shopify order account settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a valid non-sandbox configured account', async () => {
    getSettingMock.mockResolvedValue('wa-1')
    accountQuery({ data: { instance_name: 'wa-1', is_sandbox: false }, error: null })

    await expect(getDefaultShopifyOrderInstance()).resolves.toBe('wa-1')
  })

  it('rejects a sandbox account as the default', async () => {
    accountQuery({ data: { instance_name: 'sandbox', is_sandbox: true }, error: null })

    await expect(setDefaultShopifyOrderInstance('sandbox')).rejects.toThrow('Sandbox')
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('clears the setting when no account is selected', async () => {
    await expect(setDefaultShopifyOrderInstance(null)).resolves.toBeNull()
    expect(deleteSettingMock).toHaveBeenCalledTimes(1)
  })
})

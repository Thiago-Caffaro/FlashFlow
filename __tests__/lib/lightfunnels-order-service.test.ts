jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: jest.fn() } }))
jest.mock('@/lib/fulfillment-service', () => ({ recordOrderEvent: jest.fn() }))
jest.mock('@/lib/flow-jobs', () => ({ enqueueLightfunnelsOrderFlowJob: jest.fn() }))
jest.mock('@/lib/order-account-routing', () => ({ assignConfirmationAccount: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('@/lib/lightfunnels-order-service')

const integration = { id: 'int-1', lfAccountId: 'acc-1', defaultCountry: 'SPAIN' }

describe('mapLightfunnelsItems', () => {
  it('groups one-unit snapshots by variant and skips removed ones', () => {
    const items = service.mapLightfunnelsItems([
      { title: 'Creme', sku: 'CR-1', price: 20, variant_id: 'v1' },
      { title: 'Creme', sku: 'CR-1', price: 20, variant_id: 'v1' },
      { title: 'Bump', sku: 'BMP', price: 5, product_id: 'p9' },
      { title: 'Removido', sku: 'X', price: 9, variant_id: 'v2', removed_at: '2026-01-01T00:00:00Z' },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      product_id: 'v1',
      lightfunnels_variant_id: 'v1',
      lightfunnels_quantity: 2,
      quantity: 2,
      sku: 'CR-1',
      total: 40,
      unit_price: 20,
    })
    expect(items[1]).toMatchObject({ product_id: 'p9', lightfunnels_product_id: 'p9', quantity: 1, total: 5 })
  })

  it('expands pack SKUs into physical units', () => {
    const [item] = service.mapLightfunnelsItems([{ title: 'Kit', sku: 'CR-1,3', price: 45, variant_id: 'v1' }])
    expect(item).toMatchObject({ sku: 'CR-1', units_per_pack: 3, lightfunnels_quantity: 1, quantity: 3, total: 45, unit_price: 15 })
  })
})

describe('mapLightfunnelsOrderPayload', () => {
  const payload = {
    node: {
      id: 'order-gid',
      name: '#1042',
      phone: '+34 600 111 222',
      customer_full_name: 'Ana Pérez',
      financial_status: 'pending',
      total: 59.9,
      currency: 'eur',
      funnel_id: 'funnel-7',
      store_id: 'store-1',
      created_at: '2026-10-01T10:00:00Z',
      shipping_address: { line1: 'Calle 1', line2: '2B', city: 'Madrid', state: 'Madrid', zip: '28001', country: 'ES' },
      items: [{ title: 'Creme', sku: 'CR-1', price: 59.9, variant_id: 'v1' }],
    },
  }

  it('maps webhook node into a fulfillment order', () => {
    const mapped = service.mapLightfunnelsOrderPayload(payload, integration, 'wa-es')
    expect(mapped).toMatchObject({
      source: 'lightfunnels',
      lightfunnels_integration_id: 'int-1',
      lightfunnels_order_id: 'order-gid',
      lightfunnels_order_name: '#1042',
      lightfunnels_funnel_id: 'funnel-7',
      order_number: 'lightfunnels-acc-1-order-gid',
      assigned_instance_name: 'wa-es',
      country: 'SPAIN',
      customer_name: 'Ana Pérez',
      address: 'Calle 1, 2B',
      province: 'Madrid',
      zipcode: '28001',
      payment_type: 'COD',
      total: 59.9,
      currency: 'EUR',
    })
    expect(mapped.contact_phone).toMatch(/34600111222/)
  })

  it('marks paid orders as PREPAID', () => {
    const mapped = service.mapLightfunnelsOrderPayload(
      { node: { ...payload.node, financial_status: 'paid' } }, integration, null,
    )
    expect(mapped.payment_type).toBe('PREPAID')
  })

  it('accepts a full country name and falls back to the integration country', () => {
    expect(service.normalizeLightfunnelsCountry('Portugal', 'SPAIN')).toBe('PORTUGAL')
    expect(service.normalizeLightfunnelsCountry('', 'SPAIN')).toBe('SPAIN')
  })

  it('rejects payloads without an order id', () => {
    expect(() => service.mapLightfunnelsOrderPayload({ node: {} }, integration, null)).toThrow('sem id')
  })
})

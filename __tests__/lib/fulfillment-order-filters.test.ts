import type { FulfillmentOrder } from '@/types'
import {
  ORDERS_PAGE_SIZE,
  countActiveFilters,
  createOrderFilters,
  filterOrders,
  paginate,
  sortOrders,
  uniqueCountries,
} from '@/lib/fulfillment-order-filters'

let seq = 0
function order(overrides: Partial<FulfillmentOrder> = {}): FulfillmentOrder {
  seq += 1
  return {
    id: `o${seq}`,
    order_number: `FF-${seq}`,
    lead_number: null,
    instance_name: 'inst-a',
    country: 'PT',
    contact_phone: `+3519100000${seq}`,
    customer_name: `Cliente ${seq}`,
    total: 10,
    currency: 'EUR',
    source: 'shopify',
    shopify_order_name: `#${1000 + seq}`,
    commercial_status: 'Não responde',
    send_status: 'Pendente',
    delivery_status: 'Não enviado',
    assigned_instance_name: null,
    confirmation_message_sent_at: null,
    confirmation_message_error: null,
    order_placed_at: '2026-10-10T12:00:00.000Z',
    created_at: '2026-10-10T12:05:00.000Z',
    ...overrides,
  } as FulfillmentOrder
}

const base = () => createOrderFilters('received_desc')

describe('filterOrders', () => {
  it('returns everything with no filters', () => {
    const orders = [order(), order()]
    expect(filterOrders(orders, base())).toHaveLength(2)
  })

  it('matches search on name, phone and display number', () => {
    const a = order({ customer_name: 'Maria Silva' })
    const b = order({ contact_phone: '+351912345678' })
    const c = order({ shopify_order_name: '#9999' })
    const orders = [a, b, c]
    expect(filterOrders(orders, { ...base(), search: 'maria' })).toEqual([a])
    expect(filterOrders(orders, { ...base(), search: '912345678' })).toEqual([b])
    expect(filterOrders(orders, { ...base(), search: '#9999' })).toEqual([c])
  })

  it('filters by commercial, send and delivery status', () => {
    const a = order({ commercial_status: 'Confirmado', send_status: 'Enviado', delivery_status: 'Entregue' })
    const b = order()
    expect(filterOrders([a, b], { ...base(), commercialStatus: 'Confirmado' })).toEqual([a])
    expect(filterOrders([a, b], { ...base(), sendStatus: 'Pendente' })).toEqual([b])
    expect(filterOrders([a, b], { ...base(), deliveryStatus: 'Entregue' })).toEqual([a])
  })

  it('matches the account on instance_name or assigned_instance_name', () => {
    const a = order({ instance_name: 'inst-a' })
    const b = order({ instance_name: 'inst-b', assigned_instance_name: 'inst-a' })
    const c = order({ instance_name: 'inst-c' })
    expect(filterOrders([a, b, c], { ...base(), instance: 'inst-a' })).toEqual([a, b])
  })

  it('filters by source, country and confirmation trigger state', () => {
    const shopify = order({ source: 'shopify', country: 'PT' })
    const lf = order({ source: 'lightfunnels', country: 'ES', confirmation_message_sent_at: '2026-10-10T13:00:00.000Z' })
    const failed = order({ source: 'manual', confirmation_message_error: 'boom' })
    const orders = [shopify, lf, failed]
    expect(filterOrders(orders, { ...base(), source: 'lightfunnels' })).toEqual([lf])
    expect(filterOrders(orders, { ...base(), country: 'ES' })).toEqual([lf])
    expect(filterOrders(orders, { ...base(), triggerState: 'sent' })).toEqual([lf])
    expect(filterOrders(orders, { ...base(), triggerState: 'failed' })).toEqual([failed])
    expect(filterOrders(orders, { ...base(), triggerState: 'pending' })).toEqual([shopify])
  })

  it('filters by an inclusive local-day range on order_placed_at', () => {
    const early = order({ order_placed_at: new Date(2026, 9, 1, 0, 0, 0).toISOString() })
    const edge = order({ order_placed_at: new Date(2026, 9, 5, 23, 59, 0).toISOString() })
    const late = order({ order_placed_at: new Date(2026, 9, 6, 0, 0, 0).toISOString() })
    expect(filterOrders([early, edge, late], { ...base(), dateFrom: '2026-10-02', dateTo: '2026-10-05' })).toEqual([edge])
    expect(filterOrders([early, edge, late], { ...base(), dateFrom: '2026-10-05' })).toEqual([edge, late])
    expect(filterOrders([early, edge, late], { ...base(), dateTo: '2026-10-01' })).toEqual([early])
  })
})

describe('sortOrders', () => {
  const old = order({ created_at: '2026-10-01T00:00:00.000Z', order_placed_at: '2026-10-03T00:00:00.000Z', total: 50, customer_name: 'Zé' })
  const mid = order({ created_at: '2026-10-02T00:00:00.000Z', order_placed_at: '2026-10-02T00:00:00.000Z', total: 5, customer_name: 'Ana' })
  const recent = order({ created_at: '2026-10-03T00:00:00.000Z', order_placed_at: '2026-10-01T00:00:00.000Z', total: 20, customer_name: 'Bia' })
  const orders = [mid, old, recent]

  it('sorts by received date', () => {
    expect(sortOrders(orders, 'received_desc')).toEqual([recent, mid, old])
    expect(sortOrders(orders, 'received_asc')).toEqual([old, mid, recent])
  })

  it('sorts by order placed date', () => {
    expect(sortOrders(orders, 'placed_desc')).toEqual([old, mid, recent])
    expect(sortOrders(orders, 'placed_asc')).toEqual([recent, mid, old])
  })

  it('sorts by total and customer name', () => {
    expect(sortOrders(orders, 'total_desc')).toEqual([old, recent, mid])
    expect(sortOrders(orders, 'total_asc')).toEqual([mid, recent, old])
    expect(sortOrders(orders, 'name_asc')).toEqual([mid, recent, old])
  })

  it('does not mutate the input', () => {
    const input = [...orders]
    sortOrders(input, 'total_desc')
    expect(input).toEqual(orders)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => i)

  it('caps each page at 20 items', () => {
    expect(ORDERS_PAGE_SIZE).toBe(20)
    expect(paginate(items, 1).items).toHaveLength(20)
    expect(paginate(items, 2).items).toHaveLength(20)
    expect(paginate(items, 3).items).toEqual([40, 41, 42, 43, 44])
    expect(paginate(items, 1).totalPages).toBe(3)
  })

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99).page).toBe(3)
    expect(paginate(items, 0).page).toBe(1)
    expect(paginate(items, Number.NaN).page).toBe(1)
  })

  it('handles an empty list', () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, totalPages: 1, totalItems: 0 })
  })
})

describe('helpers', () => {
  it('counts active filters ignoring the sort', () => {
    expect(countActiveFilters(base())).toBe(0)
    expect(countActiveFilters({ ...base(), sort: 'total_desc' })).toBe(0)
    expect(countActiveFilters({ ...base(), search: 'x', country: 'PT', dateFrom: '2026-10-01' })).toBe(3)
  })

  it('lists unique sorted countries', () => {
    expect(uniqueCountries([order({ country: 'PT' }), order({ country: 'ES' }), order({ country: 'PT' })])).toEqual(['ES', 'PT'])
  })
})

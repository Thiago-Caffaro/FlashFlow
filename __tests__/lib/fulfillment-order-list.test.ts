import { FULFILLMENT_ORDER_LIST_SELECT, toFulfillmentOrderListItem } from '@/lib/fulfillment-order-list'
import { getShopifyOrderStatus } from '@/lib/shopify-order-status'

describe('fulfillment order list projection', () => {
  it('never selects the full Shopify payload or the FenixCOD snapshot', () => {
    const columns = FULFILLMENT_ORDER_LIST_SELECT.split(',').map((column) => column.trim())
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('raw_shopify_payload')
    expect(columns).not.toContain('external_snapshot')
    expect(columns).toContain('raw_line_items:raw_shopify_payload->line_items')
    expect(columns).toContain('raw_financial_status:raw_shopify_payload->>financial_status')
  })

  it('rebuilds a slim raw_shopify_payload in the shape the UI already reads', () => {
    const lineItems = [{ sku: '-DS-6228,3', quantity: 1 }]
    const order = toFulfillmentOrderListItem({
      id: 'order-1',
      shopify_financial_status: null,
      shopify_cancelled_at: null,
      raw_line_items: lineItems,
      raw_financial_status: 'paid',
      raw_fulfillment_status: null,
      raw_cancelled_at: '2026-10-01T10:00:00Z',
      raw_cancel_reason: 'customer',
    } as unknown as Parameters<typeof toFulfillmentOrderListItem>[0])

    expect(order.raw_shopify_payload).toEqual({
      line_items: lineItems,
      financial_status: 'paid',
      cancelled_at: '2026-10-01T10:00:00Z',
      cancel_reason: 'customer',
    })
    expect(order.external_snapshot).toBeNull()
    expect(order).not.toHaveProperty('raw_line_items')
    // Fallbacks de status continuam funcionando com o payload reduzido
    expect(getShopifyOrderStatus(order)).toMatchObject({ financialStatus: 'paid', cancelled: true })
  })

  it('returns a null payload for manual orders without Shopify data', () => {
    const order = toFulfillmentOrderListItem({ id: 'manual-1' } as unknown as Parameters<typeof toFulfillmentOrderListItem>[0])
    expect(order.raw_shopify_payload).toBeNull()
  })
})

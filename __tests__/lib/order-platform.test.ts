import {
  getOrderDisplayNumber,
  isOrderCancelled,
  isOrderPaymentSettled,
  isOrderRemoved,
  orderTriggerSourceFor,
} from '@/lib/order-platform'

describe('order-platform helpers', () => {
  it('shows the customer-facing order number for each platform', () => {
    expect(getOrderDisplayNumber({ source: 'shopify', shopify_order_name: '#1001', order_number: 'shopify-x-1' })).toBe('#1001')
    expect(getOrderDisplayNumber({ source: 'lightfunnels', lightfunnels_order_name: '#120', order_number: 'lightfunnels-a-1' })).toBe('#120')
    expect(getOrderDisplayNumber({ source: 'manual', order_number: 'FF-123' })).toBe('FF-123')
  })

  it('maps each platform to its own order trigger', () => {
    expect(orderTriggerSourceFor('shopify')).toBe('shopify_order')
    expect(orderTriggerSourceFor('lightfunnels')).toBe('lightfunnels_order')
    expect(orderTriggerSourceFor(undefined)).toBe('shopify_order')
  })

  it('detects cancellation and removal on either platform', () => {
    expect(isOrderCancelled({ lightfunnels_cancelled_at: '2026-01-01' })).toBe(true)
    expect(isOrderCancelled({ shopify_cancelled_at: '2026-01-01' })).toBe(true)
    expect(isOrderRemoved({ lightfunnels_archived_at: '2026-01-01' })).toBe(true)
    expect(isOrderRemoved({})).toBe(false)
  })

  it('reads the payment status of the order platform', () => {
    expect(isOrderPaymentSettled({ source: 'lightfunnels', lightfunnels_financial_status: 'paid' })).toBe(true)
    expect(isOrderPaymentSettled({ source: 'lightfunnels', lightfunnels_financial_status: 'pending', shopify_financial_status: 'paid' })).toBe(false)
    expect(isOrderPaymentSettled({ source: 'shopify', shopify_financial_status: 'paid' })).toBe(true)
  })
})

import {
  getShopifyOrderStatus,
  isShopifyOrderCancelled,
  isShopifyPaymentPending,
  shopifyCancelReasonLabel,
  shopifyFinancialStatusLabel,
} from '@/lib/shopify-order-status'

describe('Shopify order status', () => {
  it('uses persisted lifecycle fields before the raw payload', () => {
    const status = getShopifyOrderStatus({
      shopify_financial_status: 'paid',
      shopify_cancelled_at: '2026-08-07T12:00:00.000Z',
      shopify_cancel_reason: 'customer',
      raw_shopify_payload: { financial_status: 'pending' },
    })

    expect(status).toMatchObject({ financialStatus: 'paid', cancelled: true, cancelReason: 'customer' })
    expect(isShopifyOrderCancelled({ shopify_cancelled_at: status.cancelledAt })).toBe(true)
  })

  it('labels pending payments and cancellation reasons clearly', () => {
    expect(isShopifyPaymentPending('authorized')).toBe(true)
    expect(shopifyFinancialStatusLabel('pending')).toBe('Pagamento pendente')
    expect(shopifyCancelReasonLabel('inventory')).toBe('Produto sem estoque')
  })
})

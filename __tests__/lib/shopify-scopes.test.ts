import { withRequiredShopifyScopes } from '@/lib/shopify-scopes'

describe('withRequiredShopifyScopes', () => {
  it('adds read_draft_orders to a scope list saved before it existed', () => {
    expect(withRequiredShopifyScopes('read_orders,read_products,read_checkouts,read_inventory'))
      .toBe('read_orders,read_products,read_checkouts,read_inventory,read_draft_orders')
  })

  it('keeps extra configured scopes and does not repeat required ones', () => {
    expect(withRequiredShopifyScopes(' read_customers , read_orders,read_draft_orders'))
      .toBe('read_customers,read_orders,read_draft_orders,read_products,read_checkouts,read_inventory')
  })

  it('falls back to the required scopes when nothing is configured', () => {
    expect(withRequiredShopifyScopes(null)).toBe('read_orders,read_products,read_checkouts,read_inventory,read_draft_orders')
  })
})

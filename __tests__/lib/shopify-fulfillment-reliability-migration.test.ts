import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Shopify fulfillment reliability migration', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'migrations/013_shopify_fulfillment_reliability.sql'),
    'utf8',
  )

  it('archives deleted Shopify orders without removing their audit history', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS shopify_deleted_at timestamptz')
    expect(migration).toContain('WHERE source = \'shopify\' AND shopify_deleted_at IS NULL')
  })

  it('allows Shopify variants with the same country and SKU to share one local mirror', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS public.shopify_products_local_product_unique_idx')
    expect(migration).toContain('matching_mirror_id')
    expect(migration).not.toContain('mirror_owner_id')
    expect(migration).toContain('local_product_id = mirror_id')
  })

  it('keeps the bulk mirror RPC restricted to the service role', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.set_shopify_products_local_copy')
    expect(migration).toContain('TO service_role')
  })
})

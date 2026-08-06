import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Shopify pack quantity migration', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'migrations/014_shopify_pack_quantities.sql'),
    'utf8',
  )

  it('adds a bounded units-per-pack field', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS units_per_pack integer NOT NULL DEFAULT 1')
    expect(migration).toContain('CHECK (units_per_pack BETWEEN 1 AND 1000)')
    expect(migration).toContain('fulfillment_products_units_per_pack_check')
  })

  it('backfills and removes valid quantity suffixes from existing SKUs', () => {
    expect(migration).toContain("regexp_replace(sku, ',\\s*[1-9][0-9]{0,3}\\s*$', '')")
    expect(migration).toContain('units_per_pack = parsed.pack_units')
  })

  it('propagates the multiplier to local product mirrors', () => {
    expect(migration).toContain('sp.units_per_pack')
    expect(migration).toContain('units_per_pack = product_row.units_per_pack')
  })
})

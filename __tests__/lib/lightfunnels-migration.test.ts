import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Lightfunnels integration migration', () => {
  const migration = readFileSync(resolve(process.cwd(), 'migrations/027_lightfunnels_integration.sql'), 'utf8')

  it('stores OAuth tokens encrypted and keeps webhook ids per integration', () => {
    expect(migration).toContain('encrypted_access_token text NOT NULL')
    expect(migration).toContain('encrypted_refresh_token text NOT NULL')
    expect(migration).toContain('lf_account_id text NOT NULL UNIQUE')
    expect(migration).toContain("webhook_ids jsonb NOT NULL DEFAULT '{}'::jsonb")
  })

  it('links WhatsApp accounts with an optional funnel filter', () => {
    expect(migration).toContain("funnel_ids text[] NOT NULL DEFAULT '{}'")
    expect(migration).toContain('PRIMARY KEY (integration_id, instance_name)')
  })

  it('accepts lightfunnels orders and dedupes them per integration', () => {
    expect(migration).toContain("CHECK (source IN ('manual', 'shopify', 'lightfunnels'))")
    expect(migration).toContain('fulfillment_orders_lightfunnels_unique_idx')
  })

  it('keeps every existing flow job type when adding the Lightfunnels one', () => {
    for (const jobType of ['shopify_order_flow', 'flow_message_resume', 'delivery_status_flow', 'abandoned_checkout_flow', 'lightfunnels_order_flow']) {
      expect(migration).toContain(`'${jobType}'`)
    }
  })

  it('locks the new tables to the service role', () => {
    for (const table of ['lightfunnels_integrations', 'lightfunnels_integration_accounts', 'lightfunnels_products']) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`)
    }
  })
})

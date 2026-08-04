import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('fulfillment delivery migration', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'migrations/012_fulfillment_delivery_sync.sql'),
    'utf8'
  )

  it('claims integrations atomically and recovers abandoned leases', () => {
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain("delivery_sync_locked_at < now() - interval '15 minutes'")
    expect(migration).toContain('integrations.delivery_sync_enabled = true')
    expect(migration).toContain('integrations.delivery_sync_locked_by')
    expect(migration).toContain('claim_fulfillment_delivery_sync')
  })

  it('updates the order, event and flow outbox in one service-role-only function', () => {
    expect(migration).toContain('apply_fulfillment_delivery_status')
    expect(migration).toContain("'delivery_status_changed'")
    expect(migration).toContain("'delivery_status_flow'")
    expect(migration).toContain('ON CONFLICT (dedupe_key) DO NOTHING')
    expect(migration).toContain("triggers.instance_name = trigger_instance")
    expect(migration).toContain("triggers.source = 'delivery_status'")
    expect(migration).toContain("triggers.action = 'flow'")
    expect(migration).toContain("triggers.action_payload->'statuses'")
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.apply_fulfillment_delivery_status')
    expect(migration).toContain('TO service_role')
  })

  it.each([
    'Não enviado',
    'Enviado',
    'A caminho',
    'Novidade',
    'Rejeitado',
    'Entregue',
  ])('supports the internal delivery state %s', (status) => {
    expect(migration).toContain(`'${status}'`)
  })
})

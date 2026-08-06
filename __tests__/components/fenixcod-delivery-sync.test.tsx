import { renderToStaticMarkup } from 'react-dom/server'
import FenixCODConfig, { type Integration } from '@/components/fulfillment/fenixcod-config'

function integration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: 'integration-1',
    country: 'SPAIN',
    environment: 'production',
    active: true,
    token_expires_at: '2026-08-10T10:00:00.000Z',
    delivery_sync_enabled: false,
    delivery_sync_interval_minutes: 10,
    delivery_sync_next_at: null,
    delivery_sync_last_started_at: null,
    delivery_sync_last_completed_at: null,
    delivery_sync_last_error: null,
    delivery_sync_last_stats: null,
    ...overrides,
  }
}

describe('FenixCOD delivery sync settings', () => {
  it('renders disabled automatic sync with the supported interval and manual action', () => {
    const html = renderToStaticMarkup(
      <FenixCODConfig integrations={[integration()]} onRefresh={async () => undefined} />
    )

    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Atualizar entregas')
    expect(html).toContain('A cada 10 min')
    expect(html).toContain('Sincronizar agora')
  })

  it('renders the last successful statistics and integration error', () => {
    const html = renderToStaticMarkup(
      <FenixCODConfig integrations={[integration({
        delivery_sync_enabled: true,
        delivery_sync_last_completed_at: '2026-08-04T12:00:00.000Z',
        delivery_sync_last_error: 'Uma pagina falhou',
        delivery_sync_last_stats: { updated: 3, unknown: 1, failed: 1 },
      })]} onRefresh={async () => undefined} />
    )

    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('3 alterada(s)')
    expect(html).toContain('1 pendente(s)')
    expect(html).toContain('Uma pagina falhou')
  })
})

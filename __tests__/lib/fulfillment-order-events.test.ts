import { normalizeFulfillmentOrderEvents, type FulfillmentOrderEventRow } from '@/lib/fulfillment-order-events'

function event(overrides: Partial<FulfillmentOrderEventRow> = {}): FulfillmentOrderEventRow {
  return {
    id: 'event-1',
    event_type: 'created',
    payload: {},
    created_at: '2026-08-07T10:00:00Z',
    ...overrides,
  }
}

describe('normalizeFulfillmentOrderEvents', () => {
  it('sorts newest events first and describes each event type', () => {
    const events = normalizeFulfillmentOrderEvents([
      event({ id: '1', event_type: 'created', payload: { lead_number: 'PD-1' }, created_at: '2026-08-07T10:00:00Z' }),
      event({
        id: '2',
        event_type: 'delivery_status_changed',
        payload: { previous_status: 'Enviado', delivery_status: 'A caminho', external_status: 'in transit' },
        created_at: '2026-08-08T10:00:00Z',
      }),
    ])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      id: '2',
      message: 'Status de entrega: Enviado → A caminho (FenixCOD: "in transit")',
      critical: false,
    })
    expect(events[1]).toMatchObject({ id: '1', message: 'Pedido criado na FenixCOD (lead PD-1)', critical: false })
  })

  it('marks rejected delivery status and send failures as critical', () => {
    const events = normalizeFulfillmentOrderEvents([
      event({
        id: '1',
        event_type: 'delivery_status_changed',
        payload: { previous_status: 'A caminho', delivery_status: 'Rejeitado', external_status: 'refused' },
      }),
      event({ id: '2', event_type: 'failed', payload: { error: 'timeout' }, created_at: '2026-08-06T10:00:00Z' }),
    ])

    expect(events.find((e) => e.id === '1')).toMatchObject({ critical: true })
    expect(events.find((e) => e.id === '2')).toMatchObject({ critical: true, message: 'Falha ao enviar para a FenixCOD: timeout' })
  })

  it('drops event types unrelated to the FenixCOD delivery lifecycle', () => {
    const events = normalizeFulfillmentOrderEvents([
      event({ id: '1', event_type: 'items_updated' }),
      event({ id: '2', event_type: 'country_updated' }),
      event({ id: '3', event_type: 'created' }),
    ])

    expect(events.map((e) => e.id)).toEqual(['3'])
  })

  it('drops entries with an invalid created_at', () => {
    const events = normalizeFulfillmentOrderEvents([
      event({ id: '1', created_at: 'not-a-date' }),
    ])
    expect(events).toEqual([])
  })
})

import {
  buildSafeDeliverySnapshot,
  extractExternalDeliveryOccurredAt,
  extractExternalDeliveryStatus,
  extractFulfillmentLeadNumber,
  extractLatestHistoryDeliveryStatus,
  normalizeExternalDeliveryStatusKey,
  normalizeFulfillmentLeadPage,
} from '@/lib/fulfillment-delivery-status'

describe('fulfillment delivery status normalization', () => {
  it('normalizes accents, separators and casing into a stable mapping key', () => {
    expect(normalizeExternalDeliveryStatusKey('  En_TRÁNSITO  ')).toBe('en transito')
    expect(normalizeExternalDeliveryStatusKey('Não-enviado')).toBe('nao enviado')
  })

  it('reads the documented paginated lead shape', () => {
    const page = normalizeFulfillmentLeadPage({
      current_page: 2,
      last_page: 4,
      data: [{ n_lead: 'AR-00103', status_livrison: 'in_transit' }],
    }, 2)

    expect(page).toMatchObject({ currentPage: 2, lastPage: 4 })
    expect(extractFulfillmentLeadNumber(page.records[0])).toBe('AR-00103')
    expect(extractExternalDeliveryStatus(page.records[0])).toBe('in_transit')
  })

  it('reads pagination metadata from a nested response', () => {
    const page = normalizeFulfillmentLeadPage({
      result: {
        current_page: 3,
        last_page: 7,
        data: [{ n_lead: 'AR-00104', status_livrison: 'delivered' }],
      },
    }, 3)

    expect(page).toMatchObject({ currentPage: 3, lastPage: 7 })
    expect(extractFulfillmentLeadNumber(page.records[0])).toBe('AR-00104')
  })

  it('reads nested details and finds the matching history timestamp', () => {
    const details = {
      lead: { status_livrison: 'delivered' },
      history: [
        { status: 'confirmed', comment: 'in transit', created_at: '2026-08-01T10:00:00.000Z' },
        { status: 'confirmed', comment: 'delivered', created_at: '2026-08-02T10:00:00.000Z' },
      ],
    }

    expect(extractExternalDeliveryStatus(details)).toBe('delivered')
    expect(extractExternalDeliveryOccurredAt(details, 'delivered')).toBe('2026-08-02T10:00:00.000Z')
    expect(extractLatestHistoryDeliveryStatus(details)).toEqual({
      status: 'delivered',
      occurredAt: '2026-08-02T10:00:00.000Z',
    })
  })

  it('keeps only delivery metadata in the persisted snapshot', () => {
    const snapshot = buildSafeDeliverySnapshot({
      lead: {
        status_livrison: 'delivered',
        phone: '+000000000',
        address: 'private address',
      },
      history: [{ comment: 'delivered', created_at: '2026-08-02T10:00:00.000Z' }],
    }, 'PD-1', 'delivered')

    expect(snapshot).toMatchObject({ lead_number: 'PD-1', delivery_status: 'delivered' })
    expect(JSON.stringify(snapshot)).not.toContain('private address')
    expect(JSON.stringify(snapshot)).not.toContain('+000000000')
  })

  it('accepts a history response returned as a direct array', () => {
    const history = [
      { comment: 'in transit', created_at: '2026-08-01T10:00:00.000Z' },
      { comment: 'delivered', created_at: '2026-08-02T10:00:00.000Z' },
    ]

    expect(extractLatestHistoryDeliveryStatus(history)).toEqual({
      status: 'delivered',
      occurredAt: '2026-08-02T10:00:00.000Z',
    })
  })
})

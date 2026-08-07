import { normalizeShopifyOrderTimeline } from '@/lib/shopify-order-timeline'

describe('Shopify order timeline', () => {
  it('sanitizes event text and sorts newest events first', () => {
    const events = normalizeShopifyOrderTimeline({
      events: [
        { id: 1, created_at: '2026-08-06T10:00:00Z', verb: 'placed', description: '<b>Pedido</b> criado' },
        { id: 2, created_at: '2026-08-07T10:00:00Z', verb: 'cancelled', body: 'Cancelado&nbsp;pelo cliente' },
      ],
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ id: '2', message: 'Cancelado pelo cliente', critical: true })
    expect(events[1].message).toBe('Pedido criado')
  })

  it('drops malformed entries and provides a readable fallback', () => {
    expect(normalizeShopifyOrderTimeline({ events: [
      { id: 1, created_at: 'invalid', verb: 'paid' },
      { id: 2, created_at: '2026-08-07T10:00:00Z', verb: 'paid' },
    ] })).toEqual([expect.objectContaining({ id: '2', message: 'Atualização do pedido' })])
  })
})

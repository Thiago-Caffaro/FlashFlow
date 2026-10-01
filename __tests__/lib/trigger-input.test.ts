import { isTriggerSource, requiresFlowAction, validateDeliveryTriggerPayload } from '@/lib/trigger-input'

describe('delivery trigger input validation', () => {
  it('accepts the delivery status trigger source', () => {
    expect(isTriggerSource('delivery_status')).toBe(true)
    expect(isTriggerSource('delivery_status_changed')).toBe(false)
  })

  it('accepts the abandoned checkout source and requires it to run a flow', () => {
    expect(isTriggerSource('shopify_abandoned_checkout')).toBe(true)
    expect(requiresFlowAction('shopify_abandoned_checkout')).toBe(true)
    expect(requiresFlowAction('delivery_status')).toBe(true)
    expect(requiresFlowAction('message')).toBe(false)
    expect(requiresFlowAction('shopify_order')).toBe(false)
  })

  it('accepts only known internal delivery states', () => {
    expect(validateDeliveryTriggerPayload({ statuses: ['A caminho', 'Entregue'] })).toBeNull()
    expect(validateDeliveryTriggerPayload({ statuses: ['inventado'] })).toBe('Estados de entrega inválidos')
    expect(validateDeliveryTriggerPayload({ statuses: 'Entregue' })).toBe('Estados de entrega inválidos')
  })
})

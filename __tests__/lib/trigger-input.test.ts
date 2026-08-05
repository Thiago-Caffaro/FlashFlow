import { isTriggerSource, validateDeliveryTriggerPayload } from '@/lib/trigger-input'

describe('delivery trigger input validation', () => {
  it('accepts the delivery status trigger source', () => {
    expect(isTriggerSource('delivery_status')).toBe(true)
    expect(isTriggerSource('delivery_status_changed')).toBe(false)
  })

  it('accepts only known internal delivery states', () => {
    expect(validateDeliveryTriggerPayload({ statuses: ['A caminho', 'Entregue'] })).toBeNull()
    expect(validateDeliveryTriggerPayload({ statuses: ['inventado'] })).toBe('Estados de entrega inválidos')
    expect(validateDeliveryTriggerPayload({ statuses: 'Entregue' })).toBe('Estados de entrega inválidos')
  })
})

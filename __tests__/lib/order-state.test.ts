import {
  isOrderStateField,
  isOrderStateValue,
  orderStateValues,
  shouldSubmitToFenix,
} from '@/lib/order-state'

describe('order state definitions', () => {
  it('accepts only supported state fields and values', () => {
    expect(isOrderStateField('commercial_status')).toBe(true)
    expect(isOrderStateField('status')).toBe(false)
    expect(isOrderStateValue('commercial_status', 'Confirmado WhatsApp')).toBe(true)
    expect(isOrderStateValue('commercial_status', 'Entregue')).toBe(false)
    expect(orderStateValues('delivery_status')).toContain('Entregue')
  })

  it('submits only eligible confirmed orders', () => {
    expect(shouldSubmitToFenix({
      commercial_status: 'Confirmado WhatsApp',
      send_status: 'Pendente',
      lead_number: null,
      is_simulation: false,
    })).toBe(true)
    expect(shouldSubmitToFenix({
      commercial_status: 'Desistiu',
      send_status: 'Pendente',
      lead_number: null,
      is_simulation: false,
    })).toBe(false)
  })
})

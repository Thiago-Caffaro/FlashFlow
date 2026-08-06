export {}

const mockFrom = jest.fn()
const mockRecordOrderEvent = jest.fn()
const mockSubmitFulfillmentOrder = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/fulfillment-service', () => ({
  FulfillmentOrderSubmissionError: class FulfillmentOrderSubmissionError extends Error {},
  recordOrderEvent: mockRecordOrderEvent,
  submitFulfillmentOrder: mockSubmitFulfillmentOrder,
}))

function updateBuilder(data: Record<string, unknown>) {
  const chain: Record<string, jest.Mock> = {}
  chain.update = jest.fn(() => chain)
  chain.eq = jest.fn(() => chain)
  chain.select = jest.fn(() => chain)
  chain.single = jest.fn(async () => ({ data, error: null }))
  return chain
}

function selectBuilder(data: Record<string, unknown>) {
  const chain: Record<string, jest.Mock> = {}
  chain.select = jest.fn(() => chain)
  chain.eq = jest.fn(() => chain)
  chain.single = jest.fn(async () => ({ data, error: null }))
  return chain
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { updateFulfillmentOrderState } = require('@/lib/fulfillment-order-state')

describe('updateFulfillmentOrderState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('marks a WhatsApp confirmation and preserves automatic Fenix submission', async () => {
    const updated = updateBuilder({ id: 'order-1', commercial_status: 'Confirmado WhatsApp' })
    const eligible = selectBuilder({
      id: 'order-1',
      commercial_status: 'Confirmado WhatsApp',
      send_status: 'Pendente',
      lead_number: null,
      status: 'pending_operator',
      is_simulation: false,
    })
    mockFrom.mockReturnValueOnce(updated).mockReturnValueOnce(eligible)
    mockSubmitFulfillmentOrder.mockResolvedValue({ id: 'order-1', status: 'created' })

    const result = await updateFulfillmentOrderState({
      orderId: 'order-1',
      field: 'commercial_status',
      value: 'Confirmado WhatsApp',
      source: 'flow:flow-1:node-1',
    })

    expect(updated.update).toHaveBeenCalledWith(expect.objectContaining({
      commercial_status: 'Confirmado WhatsApp',
      confirmation_status_updated_at: expect.any(String),
      confirmed_at: expect.any(String),
    }))
    expect(mockRecordOrderEvent).toHaveBeenCalledWith('order-1', 'order_state_updated', {
      field: 'commercial_status',
      value: 'Confirmado WhatsApp',
      source: 'flow:flow-1:node-1',
    })
    expect(mockSubmitFulfillmentOrder).toHaveBeenCalledWith('order-1')
    expect(result.autoSubmit.submitted).toBe(true)
  })

  it('marks a cancelled commercial state without submitting it', async () => {
    const updated = updateBuilder({ id: 'order-2', commercial_status: 'Desistiu' })
    const ineligible = selectBuilder({
      id: 'order-2',
      commercial_status: 'Desistiu',
      send_status: 'Pendente',
      lead_number: null,
      status: 'pending_operator',
      is_simulation: false,
    })
    mockFrom.mockReturnValueOnce(updated).mockReturnValueOnce(ineligible)

    await updateFulfillmentOrderState({
      orderId: 'order-2',
      field: 'commercial_status',
      value: 'Desistiu',
      source: 'flow:flow-1:node-2',
    })

    expect(updated.update).toHaveBeenCalledWith(expect.objectContaining({
      commercial_status: 'Desistiu',
      confirmed_at: null,
    }))
    expect(mockSubmitFulfillmentOrder).not.toHaveBeenCalled()
  })

  it('rejects a value that does not belong to the selected field', async () => {
    await expect(updateFulfillmentOrderState({
      orderId: 'order-3',
      field: 'send_status',
      value: 'Entregue',
    })).rejects.toThrow('Estado do pedido inválido')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

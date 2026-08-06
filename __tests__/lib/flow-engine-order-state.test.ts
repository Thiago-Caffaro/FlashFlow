export {}

const supabaseMock = { from: jest.fn() }
const mockResolveFlowOrder = jest.fn()
const mockUpdateFulfillmentOrderState = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))
jest.mock('@/lib/ai-crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/evolution-api', () => ({ fetchEvolution: jest.fn() }))
jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))
jest.mock('@/lib/message-context', () => ({
  OrderContextPendingError: class OrderContextPendingError extends Error {},
  resolveMessageTemplateContext: jest.fn(),
  resolveFlowOrder: mockResolveFlowOrder,
}))
jest.mock('@/lib/fulfillment-order-state', () => ({
  updateFulfillmentOrderState: mockUpdateFulfillmentOrderState,
}))

function builder(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, jest.Mock> = {}
  for (const method of ['select', 'eq']) chain[method] = jest.fn(() => chain)
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  return chain
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeFlow } = require('@/lib/flow-engine')

describe('Capturar Dados flow node', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updates the exact order carried by the resumed flow', async () => {
    const flow = {
      ativo: true,
      json: {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          {
            id: 'capture',
            type: 'captureOrderData',
            position: { x: 0, y: 0 },
            data: { orderStateField: 'commercial_status', orderStateValue: 'Confirmado WhatsApp' },
          },
          { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'capture' },
          { id: 'e2', source: 'capture', target: 'end' },
        ],
      },
    }
    supabaseMock.from
      .mockReturnValueOnce(builder({ data: flow, error: null }))
      .mockReturnValueOnce(builder({ data: null, error: null }))
    mockResolveFlowOrder.mockResolvedValue({ id: 'order-exact' })
    mockUpdateFulfillmentOrderState.mockResolvedValue({
      order: { id: 'order-exact' },
      autoSubmit: { submitted: false },
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conversation-1',
      incomingMessage: 'CONFIRMAR PEDIDO',
      orderId: 'order-exact',
    })

    expect(mockResolveFlowOrder).toHaveBeenCalledWith({
      instanceName: 'wa-1',
      conversationId: 'conversation-1',
      orderId: 'order-exact',
    })
    expect(mockUpdateFulfillmentOrderState).toHaveBeenCalledWith({
      orderId: 'order-exact',
      field: 'commercial_status',
      value: 'Confirmado WhatsApp',
      source: 'flow:flow-1:capture',
    })
  })
})

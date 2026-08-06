export {}

const mockFrom = jest.fn()
const mockRpc = jest.fn()
const mockGetFulfillmentClient = jest.fn()
const mockGetLeadDetails = jest.fn()
const mockGetLeadHistory = jest.fn()
const mockGetLeadsPage = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}))

jest.mock('@/lib/fulfillment-service', () => ({
  getFulfillmentClient: mockGetFulfillmentClient,
}))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result) {
  const updates: unknown[] = []
  type Chain = {
    updates: unknown[]
    select: jest.Mock
    eq: jest.Mock
    not: jest.Mock
    update: jest.Mock
    single: jest.Mock
    maybeSingle: jest.Mock
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
  }
  let chain: Chain
  chain = {
    updates,
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    not: jest.fn(() => chain),
    update: jest.fn((value: unknown) => {
      updates.push(value)
      return chain
    }),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => ({ data: { id: 'integration-1' }, error: null })),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    lead_number: 'PD-1',
    country: 'SPAIN',
    delivery_status: 'Não enviado',
    external_delivery_status: null,
    external_delivery_status_key: null,
    delivery_status_source: 'manual',
    is_simulation: false,
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  claimFulfillmentDeliverySync,
  runClaimedFulfillmentDeliverySync,
  syncFulfillmentDeliveryOrder,
} = require('@/lib/fulfillment-delivery-sync')

describe('fulfillment delivery sync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFulfillmentClient.mockResolvedValue({
      getLeadDetails: mockGetLeadDetails,
      getLeadHistory: mockGetLeadHistory,
      getLeadsPage: mockGetLeadsPage,
    })
  })

  it('uses mapped Fenix status as the authoritative delivery state', async () => {
    const initial = builder({ data: order(), error: null })
    const mappings = builder({
      data: [{ external_status_key: 'delivered', external_label: 'delivered', delivery_status: 'Entregue' }],
      error: null,
    })
    const updated = builder({ data: order({ delivery_status: 'Entregue', delivery_status_source: 'fenixcod' }), error: null })
    mockFrom
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(updated)
    mockGetLeadDetails.mockResolvedValue({
      lead: { status_livrison: 'delivered', phone: '+000000000' },
      history: [{ comment: 'delivered', created_at: '2026-08-02T10:00:00.000Z' }],
    })
    mockRpc.mockResolvedValue({ data: [{ changed: true }], error: null })

    await expect(syncFulfillmentDeliveryOrder('order-1')).resolves.toMatchObject({
      delivery_status: 'Entregue',
      delivery_status_source: 'fenixcod',
    })

    expect(mockRpc).toHaveBeenCalledWith('apply_fulfillment_delivery_status', expect.objectContaining({
      p_order_id: 'order-1',
      p_delivery_status: 'Entregue',
      p_external_status: 'delivered',
      p_external_occurred_at: '2026-08-02T10:00:00.000Z',
    }))
    const applyCall = mockRpc.mock.calls.find(([name]) => name === 'apply_fulfillment_delivery_status')
    expect(JSON.stringify(applyCall?.[1].p_external_snapshot)).not.toContain('+000000000')
  })

  it('records an unknown external state without changing delivery_status', async () => {
    const initial = builder({ data: order(), error: null })
    const mappings = builder({ data: [], error: null })
    const observation = builder({ data: null, error: null })
    const reloaded = builder({ data: order({ external_delivery_status: 'carrier_hold' }), error: null })
    mockFrom
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(observation)
      .mockReturnValueOnce(reloaded)
    mockGetLeadDetails.mockResolvedValue({ lead: { status_livrison: 'carrier_hold' } })
    mockRpc.mockResolvedValueOnce({
      data: [{ external_status_key: 'carrier hold', external_label: 'carrier_hold', delivery_status: null }],
      error: null,
    })

    await syncFulfillmentDeliveryOrder('order-1')

    expect(mockRpc).toHaveBeenCalledWith('record_fulfillment_delivery_status', expect.any(Object))
    expect(mockRpc).not.toHaveBeenCalledWith('apply_fulfillment_delivery_status', expect.anything())
    expect(observation.updates[0]).toMatchObject({
      external_delivery_status: 'carrier_hold',
      delivery_status_sync_error: expect.stringContaining('sem mapeamento'),
    })
  })

  it('falls back to a direct history response when details omit the state', async () => {
    const initial = builder({ data: order(), error: null })
    const mappings = builder({
      data: [{ external_status_key: 'delivered', external_label: 'delivered', delivery_status: 'Entregue' }],
      error: null,
    })
    const updated = builder({ data: order({ delivery_status: 'Entregue', delivery_status_source: 'fenixcod' }), error: null })
    mockFrom
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(updated)
    mockGetLeadDetails.mockResolvedValue({ lead: { n_lead: 'PD-1' } })
    mockGetLeadHistory.mockResolvedValue([
      { comment: 'delivered', created_at: '2026-08-02T10:00:00.000Z' },
    ])
    mockRpc.mockResolvedValue({ data: [{ changed: true }], error: null })

    await syncFulfillmentDeliveryOrder('order-1')

    expect(mockGetLeadHistory).toHaveBeenCalledWith('PD-1')
    expect(mockRpc).toHaveBeenCalledWith('apply_fulfillment_delivery_status', expect.objectContaining({
      p_external_status: 'delivered',
      p_external_occurred_at: '2026-08-02T10:00:00.000Z',
    }))
  })

  it('never contacts FenixCOD for simulation orders', async () => {
    mockFrom.mockReturnValueOnce(builder({ data: order({ is_simulation: true }), error: null }))

    await expect(syncFulfillmentDeliveryOrder('order-1')).rejects.toThrow('simulação')
    expect(mockGetFulfillmentClient).not.toHaveBeenCalled()
  })

  it('paginates lead lists and skips unchanged authoritative states', async () => {
    const orders = builder({
      data: [order({
        external_delivery_status_key: 'in transit',
        delivery_status: 'A caminho',
        delivery_status_source: 'fenixcod',
      })],
      error: null,
    })
    const mappings = builder({
      data: [{ external_status_key: 'in transit', external_label: 'in transit', delivery_status: 'A caminho' }],
      error: null,
    })
    const integration = builder({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'fulfillment_orders') return orders
      if (table === 'fulfillment_delivery_status_mappings') return mappings
      if (table === 'fulfillment_integrations') return integration
      throw new Error(`Unexpected table ${table}`)
    })
    mockGetLeadsPage
      .mockResolvedValueOnce({ current_page: 1, last_page: 2, data: [{ n_lead: 'OTHER', status_livrison: 'unpacked' }] })
      .mockResolvedValueOnce({ current_page: 2, last_page: 2, data: [{ n_lead: 'PD-1', status_livrison: 'in_transit' }] })

    await expect(runClaimedFulfillmentDeliverySync({
      integration_id: 'integration-1',
      country: 'SPAIN',
      interval_minutes: 10,
      worker_id: 'worker-1',
    })).resolves.toMatchObject({ pages: 2, leads: 2, matched: 1, unchanged: 1, updated: 0 })

    expect(mockGetLeadsPage).toHaveBeenNthCalledWith(1, 'SPAIN', 1)
    expect(mockGetLeadsPage).toHaveBeenNthCalledWith(2, 'SPAIN', 2)
    expect(mockGetLeadDetails).not.toHaveBeenCalled()
    expect(integration.updates).toContainEqual(expect.objectContaining({ delivery_sync_last_error: null }))
    expect(integration.updates).toContainEqual(expect.objectContaining({
      delivery_sync_locked_at: expect.any(String),
    }))
  })

  it('does not reload details for an unchanged status that is still unmapped', async () => {
    const orders = builder({
      data: [order({ external_delivery_status_key: 'carrier hold', delivery_status_source: 'manual' })],
      error: null,
    })
    const mappings = builder({
      data: [{ external_status_key: 'carrier hold', external_label: 'carrier_hold', delivery_status: null }],
      error: null,
    })
    const integration = builder({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'fulfillment_orders') return orders
      if (table === 'fulfillment_delivery_status_mappings') return mappings
      if (table === 'fulfillment_integrations') return integration
      throw new Error(`Unexpected table ${table}`)
    })
    mockGetLeadsPage.mockResolvedValue({
      current_page: 1,
      last_page: 1,
      data: [{ n_lead: 'PD-1', status_livrison: 'carrier_hold' }],
    })

    await expect(runClaimedFulfillmentDeliverySync({
      integration_id: 'integration-1',
      country: 'SPAIN',
      interval_minutes: 10,
      worker_id: 'worker-1',
    })).resolves.toMatchObject({ matched: 1, unknown: 1, updated: 0 })

    expect(mockGetLeadDetails).not.toHaveBeenCalled()
  })

  it('retries transient list failures before completing the integration', async () => {
    const orders = builder({ data: [], error: null })
    const mappings = builder({ data: [], error: null })
    const integration = builder({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'fulfillment_orders') return orders
      if (table === 'fulfillment_delivery_status_mappings') return mappings
      if (table === 'fulfillment_integrations') return integration
      throw new Error(`Unexpected table ${table}`)
    })
    mockGetLeadsPage
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ current_page: 1, last_page: 1, data: [] })

    await expect(runClaimedFulfillmentDeliverySync({
      integration_id: 'integration-1',
      country: 'SPAIN',
      interval_minutes: 10,
      worker_id: 'worker-1',
    })).resolves.toMatchObject({ pages: 1, leads: 0, failed: 0 })

    expect(mockGetLeadsPage).toHaveBeenCalledTimes(2)
  })

  it('claims one integration through the atomic database lease', async () => {
    mockRpc.mockResolvedValue({
      data: [{ integration_id: 'integration-1', country: 'SPAIN', interval_minutes: 10, worker_id: 'worker-1' }],
      error: null,
    })

    await expect(claimFulfillmentDeliverySync({
      workerId: 'worker-1',
      integrationId: 'integration-1',
      force: true,
    })).resolves.toMatchObject({ integration_id: 'integration-1' })

    expect(mockRpc).toHaveBeenCalledWith('claim_fulfillment_delivery_sync', {
      p_worker_id: 'worker-1',
      p_limit: 1,
      p_integration_id: 'integration-1',
      p_force: true,
    })
  })
})

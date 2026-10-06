export {}

const mockFrom = jest.fn()
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}))

const mockWakeFlowJobWorker = jest.fn()
jest.mock('@/lib/flow-job-signal', () => ({
  wakeFlowJobWorker: () => mockWakeFlowJobWorker(),
}))

function builder(result: { data: unknown; error: unknown }) {
  const upserts: unknown[] = []
  type InsertChain = {
    upsert: jest.Mock
    select: jest.Mock
    maybeSingle: jest.Mock
  }
  let chain: InsertChain
  chain = {
    upsert: jest.fn((value: unknown) => {
      upserts.push(value)
      return chain
    }),
    select: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
  }
  return { chain, upserts }
}

function rescheduleBuilder(result: { data: unknown; error: unknown }) {
  const updates: unknown[] = []
  type UpdateChain = {
    update: jest.Mock
    eq: jest.Mock
    select: jest.Mock
    maybeSingle: jest.Mock
  }
  let chain: UpdateChain
  chain = {
    update: jest.fn((value: unknown) => {
      updates.push(value)
      return chain
    }),
    eq: jest.fn(() => chain),
    select: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
  }
  return { chain, updates }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { enqueueShopifyOrderFlowJob, enqueueAbandonedCheckoutFlowJob } = require('@/lib/flow-jobs')

describe('flow job enqueueing', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses a stable unique key to deduplicate repeated Shopify webhook delivery', async () => {
    const query = builder({ data: { id: 'job-1' }, error: null })
    mockFrom.mockReturnValue(query.chain)

    await enqueueShopifyOrderFlowJob({
      orderId: 'order-1',
      instanceName: 'wa-1',
      flowId: 'flow-1',
    })

    expect(query.chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupe_key: 'shopify-order:order-1',
        order_id: 'order-1',
      }),
      { onConflict: 'dedupe_key', ignoreDuplicates: true }
    )
    expect(mockWakeFlowJobWorker).toHaveBeenCalledTimes(1)
  })

  it('does not wake the worker for a duplicate webhook delivery', async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: null }).chain)

    await enqueueShopifyOrderFlowJob({ orderId: 'order-1', instanceName: 'wa-1', flowId: 'flow-1' })

    expect(mockWakeFlowJobWorker).not.toHaveBeenCalled()
  })

  it('schedules an abandoned checkout job per checkout+trigger at the requested time', async () => {
    const query = builder({ data: { id: 'job-1' }, error: null })
    mockFrom.mockReturnValue(query.chain)
    const runAt = new Date('2026-09-30T13:00:00.000Z')

    await enqueueAbandonedCheckoutFlowJob({
      checkoutId: 'checkout-1',
      triggerId: 'trigger-1',
      instanceName: 'wa-1',
      flowId: 'flow-1',
      runAt,
    })

    expect(query.upserts[0]).toMatchObject({
      job_type: 'abandoned_checkout_flow',
      dedupe_key: 'abandoned-checkout:checkout-1:trigger-1',
      checkout_id: 'checkout-1',
      order_id: null,
      next_attempt_at: '2026-09-30T13:00:00.000Z',
      expires_at: '2026-09-30T19:00:00.000Z',
    })
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('pushes an already pending checkout job forward when the checkout is updated again', async () => {
    const insert = builder({ data: null, error: null })
    const reschedule = rescheduleBuilder({ data: { id: 'job-1' }, error: null })
    mockFrom.mockReturnValueOnce(insert.chain).mockReturnValueOnce(reschedule.chain)

    const job = await enqueueAbandonedCheckoutFlowJob({
      checkoutId: 'checkout-1',
      triggerId: 'trigger-1',
      instanceName: 'wa-1',
      flowId: 'flow-1',
      runAt: new Date('2026-09-30T14:00:00.000Z'),
    })

    expect(job).toEqual({ id: 'job-1' })
    expect(reschedule.updates[0]).toMatchObject({ next_attempt_at: '2026-09-30T14:00:00.000Z' })
    expect(reschedule.chain.eq).toHaveBeenCalledWith('dedupe_key', 'abandoned-checkout:checkout-1:trigger-1')
    // Nunca ressuscita um job já concluído/cancelado
    expect(reschedule.chain.eq).toHaveBeenCalledWith('status', 'pending')
  })
})

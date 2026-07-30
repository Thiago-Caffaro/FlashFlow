export {}

const mockRpc = jest.fn()
const mockFrom = jest.fn()
const mockExecuteFlow = jest.fn()
const mockRunShopifyOrderTrigger = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}))

jest.mock('@/lib/flow-engine', () => ({
  executeFlow: mockExecuteFlow,
}))

jest.mock('@/lib/shopify-confirmation-service', () => ({
  runShopifyOrderTrigger: mockRunShopifyOrderTrigger,
}))

type Result = { data: unknown; error: { message: string } | null }

function updateBuilder(result: Result = { data: null, error: null }) {
  const updates: unknown[] = []
  type UpdateChain = {
    update: jest.Mock
    eq: jest.Mock
    then: (
      resolve: (value: Result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise<unknown>
  }
  let chain: UpdateChain
  chain = {
    update: jest.fn((value: unknown) => {
      updates.push(value)
      return chain
    }),
    eq: jest.fn(() => chain),
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  return { chain, updates }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runFlowJobWorkerOnce } = require('@/lib/flow-job-worker')

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    job_type: 'shopify_order_flow',
    dedupe_key: 'shopify-order:order-1',
    instance_name: 'wa-1',
    flow_id: 'flow-1',
    node_id: null,
    order_id: 'order-1',
    conversation_id: null,
    remote_jid: null,
    payload: {},
    status: 'processing',
    attempts: 1,
    max_attempts: 20,
    next_attempt_at: '2026-07-30T10:00:00.000Z',
    expires_at: '2099-07-30T10:02:00.000Z',
    locked_at: '2026-07-30T10:00:00.000Z',
    locked_by: 'old-worker',
    last_error: null,
    created_at: '2026-07-30T10:00:00.000Z',
    updated_at: '2026-07-30T10:00:00.000Z',
    completed_at: null,
    ...overrides,
  }
}

describe('flow job worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns without work when the atomic claim returns no job', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    await expect(runFlowJobWorkerOnce('worker-1')).resolves.toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('processes a reclaimed Shopify job serially and marks it completed', async () => {
    mockRpc.mockResolvedValue({ data: [job()], error: null })
    mockRunShopifyOrderTrigger.mockResolvedValue({ order: { id: 'order-1' } })
    const completed = updateBuilder()
    mockFrom.mockReturnValue(completed.chain)

    await expect(runFlowJobWorkerOnce('worker-2')).resolves.toBe(true)

    expect(mockRunShopifyOrderTrigger).toHaveBeenCalledWith('order-1', 'flow-1')
    expect(completed.updates[0]).toMatchObject({
      status: 'completed',
      locked_at: null,
      locked_by: null,
    })
  })

  it('returns failed work to the durable queue with backoff', async () => {
    mockRpc.mockResolvedValue({ data: [job({ attempts: 2 })], error: null })
    mockRunShopifyOrderTrigger.mockRejectedValue(new Error('Evolution indisponivel'))
    const retried = updateBuilder()
    mockFrom.mockReturnValue(retried.chain)

    await runFlowJobWorkerOnce('worker-1')

    expect(retried.updates[0]).toMatchObject({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      last_error: 'Evolution indisponivel',
    })
    expect((retried.updates[0] as { next_attempt_at: string }).next_attempt_at).toEqual(expect.any(String))
  })

  it('resumes a message job with its exact persisted order context', async () => {
    mockRpc.mockResolvedValue({
      data: [job({
        job_type: 'flow_message_resume',
        node_id: 'message-1',
        conversation_id: 'conv-1',
        remote_jid: '34600000000@s.whatsapp.net',
        payload: { isSandbox: true },
      })],
      error: null,
    })
    mockExecuteFlow.mockResolvedValue(undefined)
    const completed = updateBuilder()
    mockFrom.mockReturnValue(completed.chain)

    await runFlowJobWorkerOnce('worker-1')

    expect(mockExecuteFlow).toHaveBeenCalledWith('flow-1', expect.objectContaining({
      orderId: 'order-1',
      jobId: 'job-1',
      conversationId: 'conv-1',
      isSandbox: true,
    }), 'message-1')
  })
})

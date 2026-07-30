export {}

const mockFrom = jest.fn()
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { enqueueShopifyOrderFlowJob } = require('@/lib/flow-jobs')

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
  })
})

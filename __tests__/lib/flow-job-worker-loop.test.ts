export {}

const mockRpc = jest.fn()

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: mockRpc, from: jest.fn() },
}))
jest.mock('@/lib/flow-engine', () => ({ executeFlow: jest.fn() }))
jest.mock('@/lib/shopify-confirmation-service', () => ({
  runShopifyOrderTrigger: jest.fn(),
  runOrderFlow: jest.fn(),
  runAbandonedCheckoutTrigger: jest.fn(),
}))
jest.mock('@/lib/shopify-trigger-settings', () => ({ getShopifyTriggersEnabled: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startFlowJobWorker } = require('@/lib/flow-job-worker')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wakeFlowJobWorker } = require('@/lib/flow-job-signal')

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('flow job worker loop', () => {
  it('backs off while the queue is empty and polls immediately when a job is enqueued in-process', async () => {
    jest.useFakeTimers()
    mockRpc.mockResolvedValue({ data: [], error: null })

    startFlowJobWorker()
    await flush()
    expect(mockRpc).toHaveBeenCalledTimes(1)

    // Ociosa por 60s: 2s+4s+8s+15s+15s+15s → 6 polls, não 60 como no intervalo fixo de 1s.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 1_000) {
      jest.advanceTimersByTime(1_000)
      await flush()
    }
    expect(mockRpc).toHaveBeenCalledTimes(7)

    wakeFlowJobWorker()
    jest.advanceTimersByTime(0)
    await flush()
    expect(mockRpc).toHaveBeenCalledTimes(8)

    jest.useRealTimers()
  })
})

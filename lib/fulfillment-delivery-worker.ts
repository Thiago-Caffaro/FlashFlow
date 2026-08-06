import 'server-only'
import { hostname } from 'node:os'
import {
  claimFulfillmentDeliverySync,
  runClaimedFulfillmentDeliverySync,
} from './fulfillment-delivery-sync'

const POLL_INTERVAL_MS = 30_000
const globalWorker = globalThis as typeof globalThis & {
  __flashflowDeliveryWorkerStarted?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : 'Falha desconhecida no worker de entregas'
}

export async function runFulfillmentDeliveryWorkerOnce(
  workerId = `${hostname()}:${process.pid}:delivery`
): Promise<boolean> {
  const claim = await claimFulfillmentDeliverySync({ workerId })
  if (!claim) return false
  await runClaimedFulfillmentDeliverySync(claim)
  return true
}

export function startFulfillmentDeliveryWorker(): void {
  if (globalWorker.__flashflowDeliveryWorkerStarted) return
  globalWorker.__flashflowDeliveryWorkerStarted = true

  let working = false
  const tick = async () => {
    if (working) return
    working = true
    try {
      while (await runFulfillmentDeliveryWorkerOnce()) {
        // Integrations are intentionally synchronized one at a time.
      }
    } catch (error) {
      console.error('[delivery-worker] poll failed:', errorMessage(error))
    } finally {
      working = false
    }
  }

  void tick()
  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS)
  interval.unref()
}

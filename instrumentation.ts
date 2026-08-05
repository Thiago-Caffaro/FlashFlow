export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === 'placeholder') return

  const { startFlowJobWorker } = await import('./lib/flow-job-worker')
  const { startFulfillmentDeliveryWorker } = await import('./lib/fulfillment-delivery-worker')
  startFlowJobWorker()
  startFulfillmentDeliveryWorker()
}

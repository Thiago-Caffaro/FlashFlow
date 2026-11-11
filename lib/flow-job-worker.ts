import 'server-only'
import { hostname } from 'node:os'
import { OrderContextPendingError } from './message-context'
import type { FlowJob } from './flow-jobs'
import { executeFlow } from './flow-engine'
import { runAbandonedCheckoutTrigger, runOrderFlow, runShopifyOrderTrigger } from './shopify-confirmation-service'
import { supabaseAdmin } from './supabase-admin'
import { getShopifyTriggersEnabled } from './shopify-trigger-settings'
import { getLightfunnelsTriggersEnabled } from './lightfunnels-trigger-settings'
import { registerFlowJobWorkerWake } from './flow-job-signal'

// Fila vazia: o intervalo dobra a cada poll ocioso (1s → 2s → … → 15s).
// Cada poll é uma requisição ao Supabase (e uma linha de log cobrada);
// a 1s fixo eram ~86 mil por dia mesmo sem trabalho. Jobs enfileirados por
// este processo acordam o worker na hora (flow-job-signal), então a
// latência só cresce para jobs vindos de fora (ex: RPC de entrega) ou
// agendados para o futuro — no máximo MAX_IDLE_POLL_INTERVAL_MS.
export const MIN_POLL_INTERVAL_MS = 1_000
export const MAX_IDLE_POLL_INTERVAL_MS = 15_000

export function nextPollDelayMs(previousDelayMs: number, processedJobs: boolean): number {
  if (processedJobs) return MIN_POLL_INTERVAL_MS
  return Math.min(MAX_IDLE_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, previousDelayMs * 2))
}

const globalWorker = globalThis as typeof globalThis & {
  __flashflowJobWorkerStarted?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : 'Falha desconhecida no job'
}

function retryDelayMs(attempts: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}

async function completeJob(jobId: string) {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('flow_jobs')
    .update({
      status: 'completed',
      completed_at: now,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: now,
    })
    .eq('id', jobId)
  if (error) throw new Error(`Falha ao concluir job: ${error.message}`)
}

async function failOrRetryJob(job: FlowJob, error: unknown) {
  const now = Date.now()
  const expiresAt = job.expires_at ? new Date(job.expires_at).getTime() : Number.POSITIVE_INFINITY
  const nextAttemptAt = now + retryDelayMs(job.attempts)
  const retryable = nextAttemptAt < expiresAt && job.attempts < job.max_attempts
  const { error: updateError } = await supabaseAdmin
    .from('flow_jobs')
    .update({
      status: retryable ? 'pending' : 'failed',
      next_attempt_at: new Date(nextAttemptAt).toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: errorMessage(error),
      updated_at: new Date(now).toISOString(),
    })
    .eq('id', job.id)
  if (updateError) {
    console.error('[flow-worker] failed to update job state:', updateError.message)
  }
}

// Job enfileirado por automação simples (lib/automation-runtime.ts).
function jobAutomationId(job: FlowJob): string | undefined {
  return typeof job.payload?.automationId === 'string' ? job.payload.automationId : undefined
}

async function processJob(job: FlowJob) {
  const automationId = jobAutomationId(job)
  if (job.job_type === 'shopify_order_flow') {
    if (!job.order_id) throw new Error('Job Shopify sem order_id')
    if (!(await getShopifyTriggersEnabled())) return
    await runShopifyOrderTrigger(job.order_id, job.flow_id, {
      respectShopifyTriggerSetting: true,
      ...(automationId ? { automationId } : {}),
    })
    return
  }

  if (job.job_type === 'lightfunnels_order_flow') {
    if (!job.order_id) throw new Error('Job Lightfunnels sem order_id')
    if (!(await getLightfunnelsTriggersEnabled())) return
    await runShopifyOrderTrigger(job.order_id, job.flow_id, {
      respectShopifyTriggerSetting: true,
      ...(automationId ? { automationId } : {}),
    })
    return
  }

  if (job.job_type === 'flow_message_resume') {
    if (!job.node_id || !job.conversation_id || !job.remote_jid) {
      throw new Error('Job de mensagem sem contexto de retomada')
    }
    await executeFlow(job.flow_id, {
      instanceName: job.instance_name,
      remoteJid: job.remote_jid,
      conversationId: job.conversation_id,
      incomingMessage: '',
      orderId: job.order_id ?? undefined,
      checkoutId: typeof job.payload.checkoutId === 'string' ? job.payload.checkoutId : undefined,
      jobId: job.id,
      isSandbox: job.payload.isSandbox === true,
      realSendInstanceName: typeof job.payload.realSendInstanceName === 'string'
        ? job.payload.realSendInstanceName
        : undefined,
    }, job.node_id)
    return
  }

  if (job.job_type === 'delivery_status_flow') {
    if (!job.order_id) throw new Error('Job de entrega sem order_id')
    if (automationId) await runOrderFlow(job.order_id, job.flow_id, { automationId })
    else await runOrderFlow(job.order_id, job.flow_id)
    return
  }

  if (job.job_type === 'abandoned_checkout_flow') {
    if (!job.checkout_id) throw new Error('Job de carrinho sem checkout_id')
    if (!(await getShopifyTriggersEnabled())) return
    if (automationId) await runAbandonedCheckoutTrigger(job.checkout_id, job.flow_id, { automationId })
    else await runAbandonedCheckoutTrigger(job.checkout_id, job.flow_id)
    return
  }

  throw new Error(`Tipo de job desconhecido: ${String(job.job_type)}`)
}

export async function runFlowJobWorkerOnce(workerId = `${hostname()}:${process.pid}`): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('claim_flow_jobs', {
    p_worker_id: workerId,
    p_limit: 1,
  })
  if (error) throw new Error(`Falha ao reivindicar job: ${error.message}`)
  const job = Array.isArray(data) ? data[0] as FlowJob | undefined : undefined
  if (!job) return false

  try {
    await processJob(job)
    await completeJob(job.id)
  } catch (processError) {
    if (!(processError instanceof OrderContextPendingError) && job.job_type === 'flow_message_resume') {
      console.error('[flow-worker] message job failed:', errorMessage(processError))
    }
    await failOrRetryJob(job, processError)
  }
  return true
}

export function startFlowJobWorker(): void {
  if (globalWorker.__flashflowJobWorkerStarted) return
  globalWorker.__flashflowJobWorkerStarted = true

  let working = false
  let wakeRequested = false
  let delayMs = MIN_POLL_INTERVAL_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void tick(), ms)
    timer.unref()
  }

  const tick = async () => {
    if (working) {
      wakeRequested = true
      return
    }
    working = true
    let processed = false
    try {
      while (await runFlowJobWorkerOnce()) {
        // Jobs are intentionally drained one at a time.
        processed = true
      }
    } catch (error) {
      console.error('[flow-worker] poll failed:', errorMessage(error))
    } finally {
      working = false
    }
    // Um job enfileirado durante o dreno pode ter chegado depois do último
    // claim vazio — roda de novo já, em vez de esperar o intervalo ocioso.
    const runAgainNow = wakeRequested
    wakeRequested = false
    delayMs = nextPollDelayMs(delayMs, processed || runAgainNow)
    schedule(runAgainNow ? 0 : delayMs)
  }

  registerFlowJobWorkerWake(() => {
    delayMs = MIN_POLL_INTERVAL_MS
    if (working) wakeRequested = true
    else schedule(0)
  })

  void tick()
}

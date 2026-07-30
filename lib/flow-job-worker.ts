import 'server-only'
import { hostname } from 'node:os'
import { OrderContextPendingError } from './message-context'
import type { FlowJob } from './flow-jobs'
import { executeFlow } from './flow-engine'
import { runShopifyOrderTrigger } from './shopify-confirmation-service'
import { supabaseAdmin } from './supabase-admin'

const POLL_INTERVAL_MS = 1_000
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

async function processJob(job: FlowJob) {
  if (job.job_type === 'shopify_order_flow') {
    if (!job.order_id) throw new Error('Job Shopify sem order_id')
    await runShopifyOrderTrigger(job.order_id, job.flow_id)
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
      jobId: job.id,
      isSandbox: job.payload.isSandbox === true,
      realSendInstanceName: typeof job.payload.realSendInstanceName === 'string'
        ? job.payload.realSendInstanceName
        : undefined,
    }, job.node_id)
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
  const tick = async () => {
    if (working) return
    working = true
    try {
      while (await runFlowJobWorkerOnce()) {
        // Jobs are intentionally drained one at a time.
      }
    } catch (error) {
      console.error('[flow-worker] poll failed:', errorMessage(error))
    } finally {
      working = false
    }
  }

  void tick()
  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS)
  interval.unref()
}

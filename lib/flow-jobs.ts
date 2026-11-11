import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { wakeFlowJobWorker } from './flow-job-signal'

export type FlowJobType =
  | 'shopify_order_flow'
  | 'flow_message_resume'
  | 'delivery_status_flow'
  | 'abandoned_checkout_flow'
  | 'lightfunnels_order_flow'
export type FlowJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface FlowJob {
  id: string
  job_type: FlowJobType
  dedupe_key: string | null
  instance_name: string
  flow_id: string
  node_id: string | null
  order_id: string | null
  checkout_id: string | null
  conversation_id: string | null
  remote_jid: string | null
  payload: Record<string, unknown>
  status: FlowJobStatus
  attempts: number
  max_attempts: number
  next_attempt_at: string
  expires_at: string | null
  locked_at: string | null
  locked_by: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

async function insertJob(
  job: Omit<FlowJob, 'id' | 'status' | 'attempts' | 'next_attempt_at' | 'checkout_id' | 'locked_at' | 'locked_by' | 'last_error' | 'created_at' | 'updated_at' | 'completed_at'>
    & { checkout_id?: string; next_attempt_at?: string }
): Promise<FlowJob | null> {
  const { data, error } = await supabaseAdmin
    .from('flow_jobs')
    .upsert(job, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw new Error(`Falha ao enfileirar fluxo: ${error.message}`)
  if (data) wakeFlowJobWorker()
  return data as FlowJob | null
}

export async function enqueueShopifyOrderFlowJob(input: {
  orderId: string
  instanceName: string
  flowId: string
}): Promise<FlowJob | null> {
  return insertJob({
    job_type: 'shopify_order_flow',
    dedupe_key: `shopify-order:${input.orderId}`,
    instance_name: input.instanceName,
    flow_id: input.flowId,
    node_id: null,
    order_id: input.orderId,
    conversation_id: null,
    remote_jid: null,
    payload: {},
    max_attempts: 20,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
}

export async function enqueueLightfunnelsOrderFlowJob(input: {
  orderId: string
  instanceName: string
  flowId: string
}): Promise<FlowJob | null> {
  return insertJob({
    job_type: 'lightfunnels_order_flow',
    dedupe_key: `lightfunnels-order:${input.orderId}`,
    instance_name: input.instanceName,
    flow_id: input.flowId,
    node_id: null,
    order_id: input.orderId,
    conversation_id: null,
    remote_jid: null,
    payload: {},
    max_attempts: 20,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
}

// Retries de um job de carrinho só fazem sentido pouco depois do horário
// agendado — um lembrete de carrinho entregue um dia atrasado só incomoda.
const ABANDONED_CHECKOUT_JOB_TTL_MS = 6 * 60 * 60 * 1000

export function abandonedCheckoutDedupeKey(checkoutId: string, triggerId: string): string {
  return `abandoned-checkout:${checkoutId}:${triggerId}`
}

// Carrinho abandonado: roda só depois de (última atividade do checkout +
// delay do gatilho). O dedupe é por checkout+gatilho — vários gatilhos com
// delays diferentes (ex: 1h e 24h) viram uma sequência de lembretes. Cada
// checkouts/update da Shopify (cliente ainda preenchendo o checkout) empurra
// o job pendente para frente, em vez de disparar no meio do preenchimento.
export async function enqueueAbandonedCheckoutFlowJob(input: {
  checkoutId: string
  triggerId: string
  instanceName: string
  flowId: string
  runAt: Date
  // Lembrete de automação simples: o worker confere se ela segue ligada e
  // usa o número atual dela.
  automationId?: string
}): Promise<FlowJob | null> {
  const dedupeKey = abandonedCheckoutDedupeKey(input.checkoutId, input.triggerId)
  const nextAttemptAt = input.runAt.toISOString()
  const expiresAt = new Date(input.runAt.getTime() + ABANDONED_CHECKOUT_JOB_TTL_MS).toISOString()
  const inserted = await insertJob({
    job_type: 'abandoned_checkout_flow',
    dedupe_key: dedupeKey,
    instance_name: input.instanceName,
    flow_id: input.flowId,
    node_id: null,
    order_id: null,
    checkout_id: input.checkoutId,
    conversation_id: null,
    remote_jid: null,
    payload: input.automationId ? { triggerId: input.triggerId, automationId: input.automationId } : { triggerId: input.triggerId },
    max_attempts: 10,
    next_attempt_at: nextAttemptAt,
    expires_at: expiresAt,
  })
  if (inserted) return inserted

  const { data, error } = await supabaseAdmin
    .from('flow_jobs')
    .update({ next_attempt_at: nextAttemptAt, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('dedupe_key', dedupeKey)
    .eq('status', 'pending')
    .select()
    .maybeSingle()
  if (error) throw new Error(`Falha ao reagendar fluxo de carrinho: ${error.message}`)
  return data as FlowJob | null
}

export async function cancelPendingAbandonedCheckoutJobs(checkoutIds: string[], reason: string): Promise<void> {
  if (checkoutIds.length === 0) return
  const { error } = await supabaseAdmin
    .from('flow_jobs')
    .update({ status: 'failed', last_error: reason, updated_at: new Date().toISOString() })
    .in('checkout_id', checkoutIds)
    .eq('job_type', 'abandoned_checkout_flow')
    .eq('status', 'pending')
  if (error) throw new Error(`Falha ao cancelar fluxos de carrinho pendentes: ${error.message}`)
}

// Cancela os lembretes pendentes deste carrinho que não devem mais sair —
// ex: passou a valer uma automação (que tem precedência sobre os gatilhos da
// conta) ou deixou de valer. `keep` recebe o dedupe_key de cada job pendente.
export async function cancelStaleAbandonedCheckoutJobs(
  checkoutId: string,
  keep: (dedupeKey: string) => boolean,
  reason: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('flow_jobs')
    .select('id, dedupe_key')
    .eq('checkout_id', checkoutId)
    .eq('job_type', 'abandoned_checkout_flow')
    .eq('status', 'pending')
  if (error) throw new Error(`Falha ao consultar lembretes de carrinho pendentes: ${error.message}`)
  const stale = (data ?? [])
    .filter((job) => !keep(String(job.dedupe_key ?? '')))
    .map((job) => String(job.id))
  if (stale.length === 0) return 0
  const { error: updateError } = await supabaseAdmin
    .from('flow_jobs')
    .update({ status: 'failed', last_error: reason, updated_at: new Date().toISOString() })
    .in('id', stale)
    .eq('status', 'pending')
  if (updateError) throw new Error(`Falha ao cancelar lembretes de carrinho: ${updateError.message}`)
  return stale.length
}

export async function enqueueFlowMessageResumeJob(input: {
  instanceName: string
  flowId: string
  nodeId: string
  conversationId: string
  remoteJid: string
  orderId?: string
  checkoutId?: string
  isSandbox?: boolean
  realSendInstanceName?: string
}): Promise<FlowJob | null> {
  return insertJob({
    job_type: 'flow_message_resume',
    dedupe_key: `flow-message:${randomUUID()}`,
    instance_name: input.instanceName,
    flow_id: input.flowId,
    node_id: input.nodeId,
    order_id: input.orderId ?? null,
    conversation_id: input.conversationId,
    remote_jid: input.remoteJid,
    payload: {
      isSandbox: input.isSandbox === true,
      realSendInstanceName: input.realSendInstanceName,
      checkoutId: input.checkoutId,
    },
    max_attempts: 20,
    expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  })
}

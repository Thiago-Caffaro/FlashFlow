import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'

export type FlowJobType = 'shopify_order_flow' | 'flow_message_resume' | 'delivery_status_flow'
export type FlowJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface FlowJob {
  id: string
  job_type: FlowJobType
  dedupe_key: string | null
  instance_name: string
  flow_id: string
  node_id: string | null
  order_id: string | null
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
  job: Omit<FlowJob, 'id' | 'status' | 'attempts' | 'next_attempt_at' | 'locked_at' | 'locked_by' | 'last_error' | 'created_at' | 'updated_at' | 'completed_at'>
): Promise<FlowJob | null> {
  const { data, error } = await supabaseAdmin
    .from('flow_jobs')
    .upsert(job, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw new Error(`Falha ao enfileirar fluxo: ${error.message}`)
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

export async function enqueueFlowMessageResumeJob(input: {
  instanceName: string
  flowId: string
  nodeId: string
  conversationId: string
  remoteJid: string
  orderId?: string
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
    },
    max_attempts: 20,
    expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  })
}

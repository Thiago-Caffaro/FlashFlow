import 'server-only'
import { hostname } from 'node:os'
import { FulfillmentApiError, type FulfillmentClient } from './fulfillment-client'
import {
  buildSafeDeliverySnapshot,
  extractExternalDeliveryOccurredAt,
  extractExternalDeliveryStatus,
  extractFulfillmentLeadNumber,
  extractLatestHistoryDeliveryStatus,
  normalizeExternalDeliveryStatusKey,
  normalizeFulfillmentLeadPage,
  type DeliveryStatusMapping,
  type UnknownRecord,
} from './fulfillment-delivery-status'
import { getFulfillmentClient } from './fulfillment-service'
import { supabaseAdmin } from './supabase-admin'
import { wakeFlowJobWorker } from './flow-job-signal'
import { scheduleDeliveryStatusAutomation } from './automation-runtime'
import { scheduleLightfunnelsWriteback } from './lightfunnels-writeback'
import type { DeliveryStatus, FulfillmentOrder } from '@/types'

const MAX_LEAD_PAGES = 500
const REQUEST_ATTEMPTS = 3

export interface DeliverySyncClaim {
  integration_id: string
  country: string
  interval_minutes: number
  worker_id: string
}

export interface DeliverySyncStats {
  pages: number
  leads: number
  matched: number
  updated: number
  unchanged: number
  unknown: number
  missing: number
  failed: number
}

type SyncOrder = Pick<
  FulfillmentOrder,
  | 'id'
  | 'lead_number'
  | 'country'
  | 'delivery_status'
  | 'external_delivery_status'
  | 'external_delivery_status_key'
  | 'delivery_status_source'
  | 'source'
>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : 'Falha desconhecida na sincronização'
}

function retryable(error: unknown): boolean {
  return error instanceof FulfillmentApiError
    ? error.status === 429 || error.status >= 500
    : true
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!retryable(error) || attempt === REQUEST_ATTEMPTS) throw error
      await wait(500 * 3 ** (attempt - 1))
    }
  }
  throw lastError
}

async function loadMappings(): Promise<Map<string, DeliveryStatusMapping>> {
  const { data, error } = await supabaseAdmin
    .from('fulfillment_delivery_status_mappings')
    .select('*')
  if (error) throw new Error(`Falha ao carregar mapeamentos de entrega: ${error.message}`)
  return new Map(
    ((data ?? []) as DeliveryStatusMapping[]).map((mapping) => [mapping.external_status_key, mapping])
  )
}

async function recordStatusObservation(rawStatus: string): Promise<DeliveryStatusMapping> {
  const key = normalizeExternalDeliveryStatusKey(rawStatus)
  const { data, error } = await supabaseAdmin.rpc('record_fulfillment_delivery_status', {
    p_external_status_key: key,
    p_external_label: rawStatus,
  })
  if (error) throw new Error(`Falha ao registrar status externo: ${error.message}`)
  const mapping = Array.isArray(data) ? data[0] as DeliveryStatusMapping | undefined : undefined
  if (!mapping) throw new Error('Mapeamento externo não retornado pelo banco')
  return mapping
}

async function observeUnmappedStatus(
  orderId: string,
  leadNumber: string,
  rawStatus: string,
  snapshot: UnknownRecord
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('fulfillment_orders')
    .update({
      external_delivery_status: rawStatus.slice(0, 200),
      external_delivery_status_key: normalizeExternalDeliveryStatusKey(rawStatus),
      delivery_status_synced_at: new Date().toISOString(),
      delivery_status_sync_error: `Status FenixCOD sem mapeamento: ${rawStatus.slice(0, 120)}`,
      external_snapshot: { ...snapshot, lead_number: leadNumber },
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
  if (error) throw new Error(`Falha ao registrar status sem mapeamento: ${error.message}`)
}

async function applyMappedStatus(input: {
  orderId: string
  rawStatus: string
  mapping: DeliveryStatusMapping
  occurredAt: string | null
  snapshot: UnknownRecord
}): Promise<boolean> {
  if (!input.mapping.delivery_status) return false
  const { data, error } = await supabaseAdmin.rpc('apply_fulfillment_delivery_status', {
    p_order_id: input.orderId,
    p_delivery_status: input.mapping.delivery_status,
    p_external_status: input.rawStatus,
    p_external_status_key: input.mapping.external_status_key,
    p_external_occurred_at: input.occurredAt,
    p_external_snapshot: input.snapshot,
  })
  if (error) throw new Error(`Falha ao aplicar status de entrega: ${error.message}`)
  const result = Array.isArray(data) ? data[0] as { changed?: boolean; event_id?: string | null } | undefined : undefined
  if (result?.changed === true && result.event_id) {
    // Falha da automação não desfaz o status já aplicado.
    await scheduleDeliveryStatusAutomation(input.orderId, result.event_id, input.mapping.delivery_status)
      .catch((error) => console.error('[delivery-sync] automação de entrega falhou:', error instanceof Error ? error.message : error))
  }
  // A RPC enfileira o fluxo de entrega direto no banco — acorda o worker
  // para ele não esperar o intervalo ocioso.
  if (result?.changed === true) wakeFlowJobWorker()
  return result?.changed === true
}

async function resolveStatusFromDetails(
  client: FulfillmentClient,
  leadNumber: string,
  rawHint?: string
): Promise<{ rawStatus: string; occurredAt: string | null; snapshot: UnknownRecord }> {
  const details = await withRetry(() => client.getLeadDetails(leadNumber))
  let rawStatus = extractExternalDeliveryStatus(details) ?? rawHint ?? null
  let occurredAt = rawStatus ? extractExternalDeliveryOccurredAt(details, rawStatus) : null
  let snapshotSource: unknown = details

  if (!rawStatus) {
    const history = await withRetry(() => client.getLeadHistory(leadNumber))
    const latest = extractLatestHistoryDeliveryStatus(history)
    rawStatus = latest?.status ?? null
    occurredAt = latest?.occurredAt ?? null
    snapshotSource = history
  }

  if (!rawStatus) throw new Error('Resposta FenixCOD sem status de entrega')
  return {
    rawStatus,
    occurredAt,
    snapshot: buildSafeDeliverySnapshot(snapshotSource, leadNumber, rawStatus),
  }
}

async function syncResolvedOrder(
  order: SyncOrder,
  client: FulfillmentClient,
  mappings: Map<string, DeliveryStatusMapping>,
  rawHint?: string
): Promise<'updated' | 'unchanged' | 'unknown'> {
  if (!order.lead_number) throw new Error('Pedido sem lead_number')
  const resolved = await resolveStatusFromDetails(client, order.lead_number, rawHint)
  const key = normalizeExternalDeliveryStatusKey(resolved.rawStatus)
  let mapping = mappings.get(key)
  if (!mapping) {
    mapping = await recordStatusObservation(resolved.rawStatus)
    mappings.set(key, mapping)
  }
  if (!mapping.delivery_status) {
    await observeUnmappedStatus(order.id, order.lead_number, resolved.rawStatus, resolved.snapshot)
    return 'unknown'
  }
  const changed = await applyMappedStatus({
    orderId: order.id,
    rawStatus: resolved.rawStatus,
    mapping,
    occurredAt: resolved.occurredAt,
    snapshot: resolved.snapshot,
  })
  if (changed) scheduleLightfunnelsWriteback(order)
  return changed ? 'updated' : 'unchanged'
}

export async function syncFulfillmentDeliveryOrder(orderId: string): Promise<FulfillmentOrder> {
  const { data: order, error } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (error || !order) throw new Error(error?.message ?? 'Pedido não encontrado')
  if (order.is_simulation) throw new Error('Pedido de simulação não consulta o FenixCOD')
  if (!order.lead_number) throw new Error('Pedido ainda não possui lead_number')

  const client = await getFulfillmentClient(order.country)
  const mappings = await loadMappings()
  await syncResolvedOrder(order as SyncOrder, client, mappings)

  const { data: updated, error: updatedError } = await supabaseAdmin
    .from('fulfillment_orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (updatedError || !updated) throw new Error(updatedError?.message ?? 'Falha ao recarregar pedido')
  return updated as FulfillmentOrder
}

function createLeaseHeartbeat(claim: DeliverySyncClaim) {
  let lastHeartbeat = 0
  return async () => {
    const now = Date.now()
    if (now - lastHeartbeat < 60_000) return
    lastHeartbeat = now
    const { data, error } = await supabaseAdmin
      .from('fulfillment_integrations')
      .update({ delivery_sync_locked_at: new Date(now).toISOString() })
      .eq('id', claim.integration_id)
      .eq('delivery_sync_locked_by', claim.worker_id)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`Falha ao renovar lease da sincronização: ${error.message}`)
    if (!data) throw new Error('Lease da sincronização foi perdido para outro worker')
  }
}

async function fetchAllLeadRecords(
  client: FulfillmentClient,
  country: string,
  heartbeat: () => Promise<void>
) {
  const records: UnknownRecord[] = []
  let page = 1
  let lastPage = 1
  do {
    const response = await withRetry(() => client.getLeadsPage(country, page))
    const normalized = normalizeFulfillmentLeadPage(response, page)
    records.push(...normalized.records)
    lastPage = Math.max(page, normalized.lastPage)
    page += 1
    await heartbeat()
    if (lastPage > MAX_LEAD_PAGES) throw new Error(`FenixCOD retornou mais de ${MAX_LEAD_PAGES} páginas`)
  } while (page <= lastPage)
  return { records, pages: lastPage }
}

async function finishIntegrationSync(
  claim: DeliverySyncClaim,
  stats: DeliverySyncStats,
  error: string | null
): Promise<void> {
  const now = Date.now()
  const delayMinutes = error
    ? Math.min(30, Math.max(1, 3 ** Math.min(3, stats.failed)))
    : claim.interval_minutes
  const patch: Record<string, unknown> = {
    delivery_sync_next_at: new Date(now + delayMinutes * 60_000).toISOString(),
    delivery_sync_locked_at: null,
    delivery_sync_locked_by: null,
    delivery_sync_last_error: error,
    delivery_sync_last_stats: stats,
    delivery_sync_failures: error ? stats.failed || 1 : 0,
    updated_at: new Date(now).toISOString(),
  }
  if (!error) patch.delivery_sync_last_completed_at = new Date(now).toISOString()

  const { error: updateError } = await supabaseAdmin
    .from('fulfillment_integrations')
    .update(patch)
    .eq('id', claim.integration_id)
    .eq('delivery_sync_locked_by', claim.worker_id)
  if (updateError) throw new Error(`Falha ao concluir sincronização: ${updateError.message}`)
}

export async function runClaimedFulfillmentDeliverySync(claim: DeliverySyncClaim): Promise<DeliverySyncStats> {
  const stats: DeliverySyncStats = {
    pages: 0,
    leads: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    unknown: 0,
    missing: 0,
    failed: 0,
  }

  try {
    const client = await getFulfillmentClient(claim.country)
    const heartbeat = createLeaseHeartbeat(claim)
    await heartbeat()
    const [{ data: orders, error: ordersError }, mappings, leadResult] = await Promise.all([
      supabaseAdmin
        .from('fulfillment_orders')
        .select('id, source, lead_number, country, delivery_status, external_delivery_status, external_delivery_status_key, delivery_status_source')
        .eq('country', claim.country)
        .eq('is_simulation', false)
        .not('lead_number', 'is', null),
      loadMappings(),
      fetchAllLeadRecords(client, claim.country, heartbeat),
    ])
    if (ordersError) throw new Error(`Falha ao carregar pedidos locais: ${ordersError.message}`)

    stats.pages = leadResult.pages
    stats.leads = leadResult.records.length
    const leadsByNumber = new Map<string, UnknownRecord>()
    for (const lead of leadResult.records) {
      const leadNumber = extractFulfillmentLeadNumber(lead)
      if (leadNumber) leadsByNumber.set(leadNumber, lead)
    }

    for (const rawOrder of (orders ?? []) as SyncOrder[]) {
      await heartbeat()
      const lead = rawOrder.lead_number ? leadsByNumber.get(rawOrder.lead_number) : undefined
      if (!lead) {
        stats.missing += 1
        continue
      }
      stats.matched += 1
      const rawStatus = extractExternalDeliveryStatus(lead)
      if (!rawStatus) {
        stats.failed += 1
        continue
      }
      const key = normalizeExternalDeliveryStatusKey(rawStatus)
      if (rawOrder.external_delivery_status_key === key) {
        const existingMapping = mappings.get(key)
        if (existingMapping?.delivery_status === null) {
          stats.unknown += 1
          continue
        }
        if (
          existingMapping?.delivery_status
          && rawOrder.delivery_status_source === 'fenixcod'
          && rawOrder.delivery_status === existingMapping.delivery_status
        ) {
          stats.unchanged += 1
          continue
        }
      }

      try {
        const result = await syncResolvedOrder(rawOrder, client, mappings, rawStatus)
        stats[result] += 1
      } catch (error) {
        stats.failed += 1
        await supabaseAdmin
          .from('fulfillment_orders')
          .update({ delivery_status_sync_error: errorMessage(error), updated_at: new Date().toISOString() })
          .eq('id', rawOrder.id)
      }
    }

    const partialError = stats.failed > 0 ? `${stats.failed} pedido(s) falharam na sincronização` : null
    await finishIntegrationSync(claim, stats, partialError)
    return stats
  } catch (error) {
    stats.failed = Math.max(1, stats.failed)
    await finishIntegrationSync(claim, stats, errorMessage(error))
    throw error
  }
}

export async function claimFulfillmentDeliverySync(input: {
  workerId?: string
  integrationId?: string
  force?: boolean
} = {}): Promise<DeliverySyncClaim | null> {
  const workerId = input.workerId ?? `${hostname()}:${process.pid}:delivery`
  const { data, error } = await supabaseAdmin.rpc('claim_fulfillment_delivery_sync', {
    p_worker_id: workerId,
    p_limit: 1,
    p_integration_id: input.integrationId ?? null,
    p_force: input.force === true,
  })
  if (error) throw new Error(`Falha ao reivindicar sincronização: ${error.message}`)
  return Array.isArray(data) && data[0] ? data[0] as DeliverySyncClaim : null
}

export async function syncFulfillmentDeliveryIntegration(integrationId: string): Promise<DeliverySyncStats> {
  const claim = await claimFulfillmentDeliverySync({ integrationId, force: true })
  if (!claim) throw new Error('Integração ocupada ou inativa')
  return runClaimedFulfillmentDeliverySync(claim)
}

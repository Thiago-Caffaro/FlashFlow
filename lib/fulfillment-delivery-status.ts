import type { DeliveryStatus } from '@/types'

export type UnknownRecord = Record<string, unknown>

export interface FulfillmentLeadPage {
  records: UnknownRecord[]
  currentPage: number
  lastPage: number
}

export interface DeliveryStatusMapping {
  external_status_key: string
  external_label: string
  delivery_status: DeliveryStatus | null
  first_seen_at: string
  last_seen_at: string
  seen_count: number
  updated_at: string
}

const LEAD_NUMBER_KEYS = [
  'n_lead',
  'lead_number',
  'leadNumber',
  'lead_no',
  'leadNo',
  'number',
  'reference',
  'id',
]

const DELIVERY_STATUS_KEYS = [
  'status_livrison',
  'status_livraison',
  'delivery_status',
  'status_delivery',
  'shipping_status',
]

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function nestedRecords(record: UnknownRecord): UnknownRecord[] {
  return ['lead', 'data', 'result']
    .map((key) => record[key])
    .filter(isRecord)
}

function findNestedString(value: unknown, keys: string[], depth = 0): string | null {
  if (!isRecord(value) || depth > 3) return null
  const direct = firstString(value, keys)
  if (direct) return direct
  for (const nested of nestedRecords(value)) {
    const found = findNestedString(nested, keys, depth + 1)
    if (found) return found
  }
  return null
}

function numericValue(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function findRecordArray(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 3) return []
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  for (const key of ['data', 'leads', 'items', 'results', 'result']) {
    const records = findRecordArray(value[key], depth + 1)
    if (records.length) return records
  }
  return []
}

function findPaginationRecord(value: unknown, depth = 0): UnknownRecord | null {
  if (!isRecord(value) || depth > 3) return null
  if (value.current_page !== undefined || value.last_page !== undefined) return value
  for (const key of ['data', 'meta', 'pagination', 'result']) {
    const found = findPaginationRecord(value[key], depth + 1)
    if (found) return found
  }
  return null
}

function historyRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 4) return []
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  if (Array.isArray(value.history)) return value.history.filter(isRecord)
  for (const nested of nestedRecords(value)) {
    const found = historyRecords(nested, depth + 1)
    if (found.length) return found
  }
  return []
}

export function normalizeExternalDeliveryStatusKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function extractFulfillmentLeadNumber(value: unknown): string | null {
  return findNestedString(value, LEAD_NUMBER_KEYS)
}

export function extractExternalDeliveryStatus(value: unknown): string | null {
  return findNestedString(value, DELIVERY_STATUS_KEYS)
}

export function normalizeFulfillmentLeadPage(value: unknown, requestedPage = 1): FulfillmentLeadPage {
  const record = findPaginationRecord(value) ?? {}
  return {
    records: findRecordArray(value),
    currentPage: numericValue(record.current_page, requestedPage),
    lastPage: numericValue(record.last_page, requestedPage),
  }
}

export function extractExternalDeliveryOccurredAt(value: unknown, rawStatus: string): string | null {
  const statusKey = normalizeExternalDeliveryStatusKey(rawStatus)
  const matchingDates = historyRecords(value)
    .filter((entry) => {
      const status = firstString(entry, ['comment', 'status', ...DELIVERY_STATUS_KEYS])
      return status ? normalizeExternalDeliveryStatusKey(status) === statusKey : false
    })
    .map((entry) => firstString(entry, ['created_at', 'updated_at', 'happened_at', 'date']))
    .filter((date): date is string => Boolean(date && !Number.isNaN(Date.parse(date))))
    .sort((left, right) => Date.parse(right) - Date.parse(left))
  return matchingDates[0] ?? null
}

export function extractLatestHistoryDeliveryStatus(value: unknown): { status: string; occurredAt: string | null } | null {
  const candidates = historyRecords(value)
    .map((entry) => ({
      status: firstString(entry, ['comment', ...DELIVERY_STATUS_KEYS, 'status']),
      occurredAt: firstString(entry, ['created_at', 'updated_at', 'happened_at', 'date']),
    }))
    .filter((entry): entry is { status: string; occurredAt: string | null } => Boolean(entry.status))
    .sort((left, right) => {
      const leftTime = left.occurredAt && !Number.isNaN(Date.parse(left.occurredAt)) ? Date.parse(left.occurredAt) : 0
      const rightTime = right.occurredAt && !Number.isNaN(Date.parse(right.occurredAt)) ? Date.parse(right.occurredAt) : 0
      return rightTime - leftTime
    })
  return candidates[0] ?? null
}

export function buildSafeDeliverySnapshot(value: unknown, leadNumber: string, rawStatus: string): UnknownRecord {
  const history = historyRecords(value).slice(-100).map((entry) => ({
    status: firstString(entry, ['status']),
    delivery_status: firstString(entry, ['comment', ...DELIVERY_STATUS_KEYS]),
    created_at: firstString(entry, ['created_at', 'updated_at', 'happened_at', 'date']),
  }))
  return {
    lead_number: leadNumber,
    delivery_status: rawStatus,
    history,
  }
}

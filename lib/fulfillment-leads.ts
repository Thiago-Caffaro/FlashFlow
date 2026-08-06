import type { ExternalFulfillmentLead } from '@/types'

type UnknownRecord = Record<string, unknown>

const ARRAY_KEYS = ['data', 'leads', 'items', 'results', 'result']
const LEAD_NUMBER_KEYS = [
  'n_lead',
  'lead_number',
  'leadNumber',
  'lead_no',
  'leadNo',
  'lead_id',
  'leadId',
  'lead',
  'number',
  'ref',
  'reference',
  'reference_number',
  'referenceNumber',
  'id',
]

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function recordsFromArray(value: unknown): UnknownRecord[] | null {
  if (!Array.isArray(value)) return null
  return value.filter(isRecord)
}

function firstString(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const compact = value.trim().replace(/\s/g, '')
  if (!compact) return null
  const numeric = compact.includes(',') && /,\d{1,2}$/.test(compact)
    ? compact.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
    : compact.replace(/,/g, '').replace(/[^\d.-]/g, '')
  const parsed = Number(numeric)
  return Number.isFinite(parsed) ? parsed : null
}

function firstNumber(record: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = parseNumber(record[key])
    if (value !== null) return value
  }
  return null
}

function looksLikeLead(record: UnknownRecord): boolean {
  return Boolean(firstString(record, [
    ...LEAD_NUMBER_KEYS,
    'order_number',
    'orderNumber',
    'name_costumer',
    'customer_name',
    'mobile',
  ]))
}

function extractLeadRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 3) return []
  const directArray = recordsFromArray(value)
  if (directArray) return directArray
  if (!isRecord(value)) return []

  for (const key of ARRAY_KEYS) {
    const nested = value[key]
    const nestedRecords = extractLeadRecords(nested, depth + 1)
    if (nestedRecords.length) return nestedRecords
  }

  return looksLikeLead(value) ? [value] : []
}

export function normalizeExternalFulfillmentLeads(response: unknown, fallbackCountry: string): ExternalFulfillmentLead[] {
  return extractLeadRecords(response).map((lead, index) => {
    const leadNumber = firstString(lead, LEAD_NUMBER_KEYS)
    const orderNumber = firstString(lead, ['order_number', 'orderNumber', 'order', 'reference_order'])
    return {
      source: 'fenixcod',
      lead_number: leadNumber ?? orderNumber ?? `external-${index + 1}`,
      order_number: orderNumber,
      country: firstString(lead, ['country', 'country_name']) ?? fallbackCountry,
      customer_name: firstString(lead, ['name_costumer', 'name_customer', 'customer_name', 'costumer_name', 'client_name', 'name']),
      contact_phone: firstString(lead, ['mobile', 'phone', 'telephone', 'contact_phone', 'customer_phone']),
      city: firstString(lead, ['city', 'customer_city']),
      total: firstNumber(lead, ['total', 'lead_value', 'value', 'price', 'amount']),
      currency: firstString(lead, ['currency', 'currency_code']),
      status: firstString(lead, ['status_livrison', 'status_livraison', 'delivery_status', 'status', 'confirmation', 'confirmation_status', 'state']),
      created_at: firstString(lead, ['created_at', 'createdAt', 'date', 'date_created']),
      updated_at: firstString(lead, ['updated_at', 'updatedAt', 'date_updated']),
      raw: lead,
    }
  })
}

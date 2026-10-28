import type {
  CommercialStatus,
  ConfirmationTriggerState,
  DeliveryStatus,
  FulfillmentOrder,
  OrderSource,
  SendStatus,
} from '@/types'
import { getConfirmationTriggerState } from '@/components/fulfillment/confirmation-trigger-status'
import { getOrderDisplayNumber } from './order-platform'

// Limite de linhas por página nas abas Pedidos e Fila.
export const ORDERS_PAGE_SIZE = 20

export type OrderSortKey =
  | 'received_desc'
  | 'received_asc'
  | 'placed_desc'
  | 'placed_asc'
  | 'total_desc'
  | 'total_asc'
  | 'name_asc'

export const ORDER_SORT_OPTIONS: ReadonlyArray<{ value: OrderSortKey; label: string }> = [
  { value: 'received_desc', label: 'Recebido: mais recente' },
  { value: 'received_asc', label: 'Recebido: mais antigo' },
  { value: 'placed_desc', label: 'Data do pedido: mais recente' },
  { value: 'placed_asc', label: 'Data do pedido: mais antiga' },
  { value: 'total_desc', label: 'Valor: maior' },
  { value: 'total_asc', label: 'Valor: menor' },
  { value: 'name_asc', label: 'Cliente: A–Z' },
]

export interface OrderFilters {
  search: string
  commercialStatus: '' | CommercialStatus
  sendStatus: '' | SendStatus
  deliveryStatus: '' | DeliveryStatus
  instance: string
  source: '' | OrderSource
  country: string
  triggerState: '' | ConfirmationTriggerState
  // YYYY-MM-DD (valor de <input type="date">), dia local, inclusivo; filtra por order_placed_at.
  dateFrom: string
  dateTo: string
  sort: OrderSortKey
}

export function createOrderFilters(sort: OrderSortKey): OrderFilters {
  return {
    search: '',
    commercialStatus: '',
    sendStatus: '',
    deliveryStatus: '',
    instance: '',
    source: '',
    country: '',
    triggerState: '',
    dateFrom: '',
    dateTo: '',
    sort,
  }
}

// Quantos filtros (fora a ordenação) estão ativos — alimenta o botão "Limpar".
export function countActiveFilters(filters: OrderFilters): number {
  const { sort: _sort, ...rest } = filters
  return Object.values(rest).filter((value) => value !== '').length
}

function parseLocalDay(value: string, endOfDay: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const date = endOfDay
    ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
    : new Date(Number(year), Number(month) - 1, Number(day))
  return date.getTime()
}

function timeOf(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isNaN(time) ? 0 : time
}

export function filterOrders(orders: FulfillmentOrder[], filters: OrderFilters): FulfillmentOrder[] {
  const query = filters.search.trim().toLowerCase()
  const from = parseLocalDay(filters.dateFrom, false)
  const to = parseLocalDay(filters.dateTo, true)

  return orders.filter((order) => {
    if (query) {
      const matches =
        order.customer_name?.toLowerCase().includes(query) ||
        order.contact_phone?.includes(query) ||
        getOrderDisplayNumber(order).toLowerCase().includes(query)
      if (!matches) return false
    }
    if (filters.commercialStatus && order.commercial_status !== filters.commercialStatus) return false
    if (filters.sendStatus && order.send_status !== filters.sendStatus) return false
    if (filters.deliveryStatus && order.delivery_status !== filters.deliveryStatus) return false
    if (filters.instance && order.instance_name !== filters.instance && order.assigned_instance_name !== filters.instance) return false
    if (filters.source && (order.source ?? 'manual') !== filters.source) return false
    if (filters.country && order.country !== filters.country) return false
    if (filters.triggerState && getConfirmationTriggerState(order) !== filters.triggerState) return false
    if (from !== null || to !== null) {
      const placed = timeOf(order.order_placed_at)
      if (from !== null && placed < from) return false
      if (to !== null && placed > to) return false
    }
    return true
  })
}

export function sortOrders(orders: FulfillmentOrder[], sort: OrderSortKey): FulfillmentOrder[] {
  const copy = [...orders]
  switch (sort) {
    case 'received_desc': return copy.sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))
    case 'received_asc': return copy.sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at))
    case 'placed_desc': return copy.sort((a, b) => timeOf(b.order_placed_at) - timeOf(a.order_placed_at))
    case 'placed_asc': return copy.sort((a, b) => timeOf(a.order_placed_at) - timeOf(b.order_placed_at))
    case 'total_desc': return copy.sort((a, b) => Number(b.total) - Number(a.total))
    case 'total_asc': return copy.sort((a, b) => Number(a.total) - Number(b.total))
    case 'name_asc': return copy.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? '', 'pt-BR'))
  }
}

export interface Page<T> {
  items: T[]
  page: number
  totalPages: number
  totalItems: number
}

// `page` é 1-based e é limitado ao intervalo válido (ex.: depois de um filtro
// reduzir o total de páginas).
export function paginate<T>(items: T[], page: number, pageSize = ORDERS_PAGE_SIZE): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (safePage - 1) * pageSize
  return { items: items.slice(start, start + pageSize), page: safePage, totalPages, totalItems: items.length }
}

export function uniqueCountries(orders: FulfillmentOrder[]): string[] {
  return [...new Set(orders.map((order) => order.country).filter(Boolean))].sort()
}

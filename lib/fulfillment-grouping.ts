import { FulfillmentOrder } from '@/types'
import { normalizePhone } from './phone'

export interface CustomerGroup {
  key: string
  phone: string
  customerName: string
  orders: FulfillmentOrder[]
}

export function groupOrdersByCustomer(orders: FulfillmentOrder[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>()

  orders.forEach((order) => {
    const normalized = normalizePhone(order.contact_phone)
    const key = normalized || `order:${order.id}`
    const existing = groups.get(key)
    if (existing) {
      existing.orders.push(order)
      const mostRecent = existing.orders.reduce((a, b) =>
        new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
      )
      existing.customerName = mostRecent.customer_name
    } else {
      groups.set(key, {
        key,
        phone: order.contact_phone,
        customerName: order.customer_name,
        orders: [order],
      })
    }
  })

  return [...groups.values()]
}

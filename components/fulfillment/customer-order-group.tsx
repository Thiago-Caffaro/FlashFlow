'use client'

import { ReactNode, useState } from 'react'
import { FulfillmentOrder } from '@/types'
import { CustomerGroup } from '@/lib/fulfillment-grouping'

interface CustomerOrderGroupProps {
  group: CustomerGroup
  renderOrder: (order: FulfillmentOrder) => ReactNode
  renderGroupHeader: (group: CustomerGroup, expanded: boolean) => ReactNode
}

export default function CustomerOrderGroup({ group, renderOrder, renderGroupHeader }: CustomerOrderGroupProps) {
  const [expanded, setExpanded] = useState(false)

  if (group.orders.length === 1) {
    return <>{renderOrder(group.orders[0])}</>
  }

  return (
    <div>
      <div onClick={() => setExpanded((v) => !v)} className="cursor-pointer">
        {renderGroupHeader(group, expanded)}
      </div>
      {expanded && (
        <div className="space-y-2 pl-3 pt-2">
          {group.orders.map((order) => (
            <div key={order.id}>{renderOrder(order)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

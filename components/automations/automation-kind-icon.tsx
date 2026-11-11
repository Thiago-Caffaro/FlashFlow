'use client'

import { MessageSquareText, Package, ShoppingCart, Truck } from 'lucide-react'
import type { AutomationKind } from '@/types'

interface AutomationKindIconProps {
  kind: AutomationKind
  size?: number
  className?: string
}

export default function AutomationKindIcon({ kind, size = 18, className }: AutomationKindIconProps) {
  if (kind === 'order_created') return <Package size={size} className={className} />
  if (kind === 'delivery_status') return <Truck size={size} className={className} />
  if (kind === 'message_keyword') return <MessageSquareText size={size} className={className} />
  return <ShoppingCart size={size} className={className} />
}

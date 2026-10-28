'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ORDERS_PAGE_SIZE } from '@/lib/fulfillment-order-filters'

interface PaginationControlsProps {
  page: number
  totalPages: number
  totalItems: number
  itemLabel: string
  pageSize?: number
  onPageChange: (page: number) => void
}

const pageBtn = 'flex items-center gap-1 rounded-lg bg-[#f0f2f5] px-3 py-1.5 text-xs font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

export default function PaginationControls({
  page, totalPages, totalItems, itemLabel, pageSize = ORDERS_PAGE_SIZE, onPageChange,
}: PaginationControlsProps) {
  if (totalItems === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalItems)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#667781]">
      <span>{first}–{last} de {totalItems} {itemLabel}</span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={pageBtn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft size={13} />Anterior
          </button>
          <span className="font-semibold">Página {page} de {totalPages}</span>
          <button type="button" className={pageBtn} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Próxima<ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

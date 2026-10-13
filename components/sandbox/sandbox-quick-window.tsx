'use client'

import { ElementType, ReactNode } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'

interface SandboxQuickWindowProps {
  title: string
  Icon: ElementType
  count: number
  loading: boolean
  emptyText: string
  warning?: string | null
  onOpen: () => void
  children: ReactNode
}

// Mini janela da visão geral do Sandbox: resumo de uma lista com atalho
// para a aba completa.
export default function SandboxQuickWindow({
  title, Icon, count, loading, emptyText, warning, onOpen, children,
}: SandboxQuickWindowProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#e9edef] bg-white shadow-sm dark:border-[#2a3942] dark:bg-[#111b21]">
      <header className="flex items-center gap-2 border-b border-[#f0f2f5] bg-[#f8f9fa] px-3 py-2 dark:border-[#2a3942] dark:bg-[#1a2730]">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]" />
        </span>
        <Icon size={14} className="ml-1 text-[#00a884]" />
        <h3 className="flex-1 truncate text-sm font-bold text-[#111b21] dark:text-[#e9edef]">{title}</h3>
        <span className="rounded-full bg-[#e7f8f4] px-2 py-0.5 text-[11px] font-semibold text-[#008f72] dark:bg-[#00a884]/15 dark:text-[#00a884]">
          {count}
        </span>
        <button
          onClick={onOpen}
          className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-semibold text-[#667781] hover:bg-[#e9edef] hover:text-[#111b21] dark:hover:bg-[#2a3942] dark:hover:text-[#e9edef]"
          title={`Abrir ${title}`}
        >
          Abrir
          <ArrowUpRight size={13} />
        </button>
      </header>

      {warning && (
        <p className="border-b border-[#f0f2f5] bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:border-[#2a3942] dark:bg-amber-900/20 dark:text-amber-400">
          {warning}
        </p>
      )}

      <div className="max-h-60 min-h-[120px] flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 size={16} className="animate-spin text-[#00a884]" />
          </div>
        ) : count === 0 ? (
          <button
            onClick={onOpen}
            className="flex h-24 w-full items-center justify-center rounded-lg px-4 text-center text-xs text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#182229]"
          >
            {emptyText}
          </button>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

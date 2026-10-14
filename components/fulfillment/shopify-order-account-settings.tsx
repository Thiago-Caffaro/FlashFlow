import { Loader2, MessageSquareText } from 'lucide-react'
import type { Account } from '@/types'

interface Props {
  accounts: Account[]
  value: string
  busy: boolean
  onChange: (instanceName: string) => Promise<void>
}

export default function ShopifyOrderAccountSettings({ accounts, value, busy, onChange }: Props) {
  const availableAccounts = accounts.filter((account) => !account.isSandbox)

  return (
    <section className="mx-auto max-w-4xl border-b border-[#d1d7db] pb-8 dark:border-[#2a3942]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
          <MessageSquareText size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Conta padrão dos pedidos</h2>
          <p className="mt-1 text-sm text-[#667781] dark:text-[#8696a0]">
            Pedidos novos do Shopify serão vinculados a esta conta, exceto os de lojas com contas WhatsApp próprias (Editar loja → WhatsApp). Sem uma conta padrão, o sistema tenta escolher pela prioridade do país.
          </p>
          <div className="relative mt-4 max-w-md">
            <select
              value={value}
              onChange={(event) => void onChange(event.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-[#d1d7db] bg-white px-3 py-2.5 pr-10 text-sm text-[#111b21] outline-none focus:border-[#00a884] disabled:opacity-60 dark:border-[#2a3942] dark:bg-[#111b21] dark:text-[#e9edef]"
            >
              <option value="">Escolher automaticamente pelo país</option>
              {availableAccounts.map((account) => (
                <option key={account.instanceName} value={account.instanceName}>
                  {account.label || account.instanceName}
                </option>
              ))}
            </select>
            {busy && <Loader2 size={16} className="pointer-events-none absolute right-3 top-3 animate-spin text-[#00a884]" />}
          </div>
        </div>
      </div>
    </section>
  )
}

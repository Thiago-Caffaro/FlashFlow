'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { Account } from '@/types'

interface AccountContextValue {
  accounts: Account[]
  activeAccount: Account | null
  setActiveAccount: (account: Account) => void
  refreshAccounts: () => Promise<Account[]>
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  activeAccount: null,
  setActiveAccount: () => {},
  refreshAccounts: async () => [],
})

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null)

  const refreshAccounts = useCallback(async (): Promise<Account[]> => {
    try {
      const res = await fetch('/api/accounts', { cache: 'no-store' })
      const json = await res.json()
      const fetched: Account[] = json.accounts ?? []
      setAccounts(fetched)

      setActiveAccountState((prev) => {
        const savedName =
          typeof window !== 'undefined' ? localStorage.getItem('activeInstance') : null

        // Keep current active if still in the list (updating state)
        if (prev) {
          const updated = fetched.find((a) => a.instanceName === prev.instanceName)
          if (updated) return updated
        }
        // Restore from localStorage. The sandbox account is never the active account — it has its own
        // view (Sandbox tab). Ignoring it here also frees anyone stuck on it
        // by the old "Configurar gatilho" shortcut, which saved it here.
        if (savedName) {
          const found = fetched.find((a) => a.instanceName === savedName && !a.isSandbox)
          if (found) return found
        }
        // Fallback to first open account, then first account. The sandbox
        // account always reports state 'open' but must never be auto-picked.
        const selectable = fetched.filter((a) => !a.isSandbox)
        return selectable.find((a) => a.state === 'open') ?? selectable[0] ?? null
      })

      return fetched
    } catch {
      // network error — keep current state
      return []
    }
  }, [])

  const setActiveAccount = (account: Account) => {
    setActiveAccountState(account)
    if (typeof window !== 'undefined') {
      localStorage.setItem('activeInstance', account.instanceName)
    }
  }

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  return (
    <AccountContext.Provider value={{ accounts, activeAccount, setActiveAccount, refreshAccounts }}>
      {children}
    </AccountContext.Provider>
  )
}

export const useAccount = () => useContext(AccountContext)

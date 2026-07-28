'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import LoginForm from '@/components/auth/login-form'

type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  isAuthenticated: boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

// Nome legado usado antes da sessão passar a depender só do cookie HttpOnly.
// Mantido apenas para limpar qualquer token remanescente em navegadores que
// autenticaram antes desta correção — não é mais lido para decidir o estado.
const LEGACY_STORAGE_KEY = 'ff_auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')

  // A sessão vive inteiramente no cookie HttpOnly — o navegador o envia
  // automaticamente, então basta perguntar ao servidor se ele é válido.
  const verify = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/verify', { method: 'GET' })
      const json = await res.json()
      return json.ok === true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    verify().then((ok) => setState(ok ? 'authenticated' : 'unauthenticated'))
  }, [verify])

  function login() {
    setState('authenticated')
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setState('unauthenticated')
  }

  if (state === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a]">
        <div className="w-8 h-8 rounded-full border-2 border-[#00a884] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated: state === 'authenticated', logout }}>
      {state === 'authenticated' ? children : <LoginForm onLogin={login} />}
    </AuthContext.Provider>
  )
}

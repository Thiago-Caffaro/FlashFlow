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

const STORAGE_KEY = 'ff_auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')

  const verify = useCallback(async (token: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      const json = await res.json()
      return json.ok === true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY)
    if (!token) {
      setState('unauthenticated')
      return
    }
    verify(token).then((ok) => setState(ok ? 'authenticated' : 'unauthenticated'))
  }, [verify])

  function login(token: string) {
    localStorage.setItem(STORAGE_KEY, token)
    setState('authenticated')
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
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

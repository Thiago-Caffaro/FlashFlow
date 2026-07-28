'use client'

import { useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { useTheme } from '@/contexts/theme-context'

interface LoginFormProps {
  onLogin: () => void
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const { theme } = useTheme()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json()
      if (json.ok) {
        onLogin()
      } else {
        setError(json.error ?? 'Erro ao autenticar')
      }
    } catch {
      setError('Erro de rede')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full bg-[#f0f2f5] dark:bg-[#2a3942] border border-transparent focus:border-[#00a884] rounded-xl px-4 py-3 text-sm text-[#111b21] dark:text-[#e9edef] outline-none transition-colors placeholder:text-[#aebac1] dark:placeholder:text-[#667781]'

  void theme

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a]">
      <div className="w-full max-w-sm mx-4">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-[#00a884] items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="white" width="28" height="28">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">FlashFlow</h1>
          <p className="text-sm text-[#667781] dark:text-[#8696a0] mt-1">Entre com suas credenciais para continuar</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-[#111b21] rounded-2xl p-6 shadow-sm border border-[#f0f2f5] dark:border-[#2a3942] space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide mb-1.5 block">
              Usuário
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] uppercase tracking-wide mb-1.5 block">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className={inputClass}
              required
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#00a884] hover:bg-[#008f72] text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// Logger mínimo do servidor: uma linha por evento, com escopo e contexto em
// key=value, sobre o console (o Docker já captura stdout/stderr).
//
// - LOG_LEVEL (error | warn | info | debug, padrão info) corta o volume em
//   produção: o detalhe de cada evento de webhook/fluxo fica em debug.
// - `throttleKey` suprime repetições do mesmo problema numa janela (ex: a
//   Evolution recusando a mesma instância a cada sync) e informa quantas
//   foram suprimidas quando volta a logar — sinal sem inundar o terminal.
// - Nunca coloque conteúdo de mensagem ou telefone completo no contexto: use
//   maskJid/maskPhone de lib/redact.ts.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type LogContext = Record<string, unknown>

const LEVEL_WEIGHT: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const DEFAULT_THROTTLE_MS = 5 * 60 * 1000
const MAX_THROTTLE_KEYS = 500
const MAX_VALUE_LENGTH = 300

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase()
  return raw === 'error' || raw === 'warn' || raw === 'debug' || raw === 'info' ? raw : 'info'
}

export function isLogLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[configuredLevel()]
}

// Erros do PostgREST (Supabase) chegam como objetos com code/details/hint —
// o code (ex: 23505 unique_violation, 23514 check_violation) é o que mais
// ajuda a diagnosticar, então vira campo próprio.
function describeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; status?: unknown; cause?: unknown }
    return {
      error: `${error.name}: ${error.message}`,
      ...(withCode.code !== undefined ? { code: String(withCode.code) } : {}),
      ...(withCode.status !== undefined ? { status: String(withCode.status) } : {}),
      ...(withCode.cause instanceof Error ? { cause: withCode.cause.message } : {}),
    }
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const out: Record<string, string> = {}
    if (record.message !== undefined) out.error = String(record.message)
    if (record.code !== undefined) out.code = String(record.code)
    if (record.details) out.details = String(record.details)
    if (record.hint) out.hint = String(record.hint)
    return Object.keys(out).length > 0 ? out : { error: JSON.stringify(record) }
  }
  return { error: String(error) }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const clipped = text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
  return /[\s"=]/.test(clipped) ? JSON.stringify(clipped) : clipped
}

function formatContext(context: LogContext | undefined): string {
  if (!context) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue
    if (key === 'err') {
      for (const [errKey, errValue] of Object.entries(describeError(value))) {
        parts.push(`${errKey}=${formatValue(errValue)}`)
      }
      continue
    }
    parts.push(`${key}=${formatValue(value)}`)
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

type ThrottleState = { lastLoggedAt: number; suppressed: number }
const throttleState = new Map<string, ThrottleState>()

// Retorna quantas ocorrências foram suprimidas desde o último log, ou null
// se esta também deve ser suprimida.
function throttle(key: string, windowMs: number, now: number): number | null {
  const state = throttleState.get(key)
  if (state && now - state.lastLoggedAt < windowMs) {
    state.suppressed += 1
    return null
  }
  const suppressed = state?.suppressed ?? 0
  if (!state && throttleState.size >= MAX_THROTTLE_KEYS) {
    const oldestKey = throttleState.keys().next().value
    if (oldestKey !== undefined) throttleState.delete(oldestKey)
  }
  throttleState.set(key, { lastLoggedAt: now, suppressed: 0 })
  return suppressed
}

export interface LogOptions {
  // Mesma chave dentro da janela = log suprimido (contado).
  throttleKey?: string
  throttleMs?: number
}

export interface Logger {
  error(message: string, context?: LogContext, options?: LogOptions): void
  warn(message: string, context?: LogContext, options?: LogOptions): void
  info(message: string, context?: LogContext, options?: LogOptions): void
  debug(message: string, context?: LogContext, options?: LogOptions): void
}

export function createLogger(scope: string): Logger {
  function emit(level: LogLevel, message: string, context?: LogContext, options?: LogOptions) {
    if (!isLogLevelEnabled(level)) return
    let suffix = ''
    if (options?.throttleKey) {
      const suppressed = throttle(`${scope}:${options.throttleKey}`, options.throttleMs ?? DEFAULT_THROTTLE_MS, Date.now())
      if (suppressed === null) return
      if (suppressed > 0) suffix = ` (+${suppressed} ocorrências iguais suprimidas)`
    }
    const line = `[${scope}] ${message}${formatContext(context)}${suffix}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    error: (message, context, options) => emit('error', message, context, options),
    warn: (message, context, options) => emit('warn', message, context, options),
    info: (message, context, options) => emit('info', message, context, options),
    debug: (message, context, options) => emit('debug', message, context, options),
  }
}

export function _resetLoggerThrottleForTests(): void {
  throttleState.clear()
}

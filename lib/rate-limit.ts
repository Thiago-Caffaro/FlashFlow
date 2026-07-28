import 'server-only'

interface Bucket {
  count: number
  resetAt: number
}

// Rate limit em memória — suficiente para o modelo atual de deploy (uma
// única réplica). Se o deploy passar a rodar múltiplas réplicas, precisa
// migrar para um contador compartilhado (Postgres/Redis) para continuar eficaz.
const buckets = new Map<string, Bucket>()

/** Verifica e registra uma tentativa sob `key`. Retorna false se excedeu `limit` em `windowMs`. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

/** Exposto apenas para testes — limpa todos os contadores. */
export function _resetRateLimitForTests() {
  buckets.clear()
}

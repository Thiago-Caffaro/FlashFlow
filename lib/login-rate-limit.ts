import 'server-only'

interface Bucket {
  count: number
  resetAt: number
}

// Rate limit de login em memória — suficiente para o modelo atual de deploy
// (uma única réplica do container FlashFlow). Se o deploy passar a rodar
// múltiplas réplicas, isto precisa migrar para um contador compartilhado
// (ex: tabela no Postgres ou Redis) para continuar eficaz.
const buckets = new Map<string, Bucket>()

const IP_LIMIT = 20
const IP_WINDOW_MS = 5 * 60 * 1000
const USER_LIMIT = 5
const USER_WINDOW_MS = 60 * 1000

function hit(key: string, limit: number, windowMs: number): boolean {
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

function purgeStale() {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key)
  }
}

/**
 * Verifica e registra uma tentativa de login. Aplica dois limites
 * independentes: um por IP (contra varreduras de usuários) e um por
 * IP+usuário (contra credential stuffing/força bruta no usuário conhecido).
 * Retorna false quando qualquer um dos limites foi excedido.
 */
export function checkLoginRateLimit(ip: string, username: string): boolean {
  if (buckets.size > 10_000) purgeStale()
  const ipOk = hit(`ip:${ip}`, IP_LIMIT, IP_WINDOW_MS)
  const userOk = hit(`user:${ip}:${username}`, USER_LIMIT, USER_WINDOW_MS)
  return ipOk && userOk
}

/** Exposto apenas para testes — limpa todos os contadores. */
export function _resetLoginRateLimitForTests() {
  buckets.clear()
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

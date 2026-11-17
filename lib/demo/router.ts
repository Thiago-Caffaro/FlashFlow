import { DEMO_WRITE_BLOCKED_MESSAGE } from './config'
import { getStore } from './store'
import type { DemoHandler, DemoRequest, DemoResult } from './types'

interface RouteEntry {
  method: string
  segments: string[]
  paramCount: number
  handler: DemoHandler
}

const routes: RouteEntry[] = []

/** Regista um handler. `pattern` usa `:nome` para segmentos variáveis. */
export function route(method: string, pattern: string, handler: DemoHandler): void {
  const segments = pattern.split('/').filter(Boolean)
  routes.push({
    method: method.toUpperCase(),
    segments,
    paramCount: segments.filter((s) => s.startsWith(':')).length,
    handler,
  })
}

export function clearRoutes(): void {
  routes.length = 0
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function match(entry: RouteEntry, method: string, segments: string[]): Record<string, string> | null {
  if (entry.method !== method || entry.segments.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const expected = entry.segments[i]
    if (expected.startsWith(':')) params[expected.slice(1)] = decode(segments[i])
    else if (expected !== segments[i]) return null
  }
  return params
}

/** Extrai o corpo como objeto, para handlers que esperam JSON. */
export function bodyOf(req: DemoRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !(req.body instanceof FormData)
    ? (req.body as Record<string, unknown>)
    : {}
}

export const ok = (data: Record<string, unknown> = {}): DemoResult => ({ json: { ok: true, ...data } })

export const fail = (error: string, status = 400): DemoResult => ({ status, json: { ok: false, error } })

export const blocked = (): DemoResult => fail(DEMO_WRITE_BLOCKED_MESSAGE)

export async function dispatch(method: string, url: string, body: unknown): Promise<DemoResult> {
  const upper = method.toUpperCase()
  const [rawPath, rawQuery = ''] = url.split('?')
  const segments = rawPath.split('/').filter(Boolean)

  let best: { entry: RouteEntry; params: Record<string, string> } | null = null
  for (const entry of routes) {
    const params = match(entry, upper, segments)
    if (params && (!best || entry.paramCount < best.entry.paramCount)) best = { entry, params }
  }

  if (!best) {
    // Leitura sem handler: os ecrãs tratam a ausência de dados como lista
    // vazia. Escrita sem handler: recusada de forma visível.
    return upper === 'GET' ? ok() : blocked()
  }

  try {
    return await best.entry.handler(
      { method: upper, path: rawPath, params: best.params, query: new URLSearchParams(rawQuery), body },
      getStore(),
    )
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Erro na demonstração', 500)
  }
}

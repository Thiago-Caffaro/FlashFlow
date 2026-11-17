import { BASE_PATH, IS_DEMO } from './config'
import { registerDemoHandlers } from './handlers'
import { dispatch } from './router'

function toApiPath(input: RequestInfo | URL, basePath: string, origin: string): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let pathAndQuery = raw
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!raw.startsWith(`${origin}/`)) return null
    pathAndQuery = raw.slice(origin.length)
  }
  if (basePath && pathAndQuery.startsWith(`${basePath}/`)) pathAndQuery = pathAndQuery.slice(basePath.length)
  return pathAndQuery.startsWith('/api/') ? pathAndQuery : null
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }
  return body
}

/** Cria um `fetch` que responde a `/api/*` em memória e delega o resto. */
export function createDemoFetch(original: typeof fetch, basePath: string, origin: string): typeof fetch {
  return async (input, init) => {
    const apiPath = toApiPath(input, basePath, origin)
    if (!apiPath) return original(input, init)
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const result = await dispatch(method, apiPath, parseBody(init?.body))
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

let installed = false

export function installDemoFetch(): void {
  if (!IS_DEMO || installed || typeof window === 'undefined') return
  installed = true
  registerDemoHandlers()
  window.fetch = createDemoFetch(window.fetch.bind(window), BASE_PATH, window.location.origin)
}

// Instala ao carregar o módulo: os efeitos dos componentes filhos correm
// antes dos do pai, por isso um useEffect aqui chegaria tarde.
installDemoFetch()

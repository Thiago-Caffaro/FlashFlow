// Modo demonstração: build estático publicado no GitHub Pages, sem backend.
// Fora deste modo nada em `lib/demo` tem efeito.
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

// O Pages serve o site em /<nome-do-repositório>/.
export const DEMO_BASE_PATH = '/FlashFlow'

export const BASE_PATH = IS_DEMO ? DEMO_BASE_PATH : ''

export const DEMO_WRITE_BLOCKED_MESSAGE = 'Indisponível na demonstração'

export const DEMO_REPO_URL = 'https://github.com/Thiago-Caffaro/FlashFlow'

/** Prefixa um caminho interno absoluto com o basePath (para `<a href>` e `window.location`). */
export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith('/')) return path
  return path === '/' ? `${BASE_PATH}/` : `${BASE_PATH}${path}`
}

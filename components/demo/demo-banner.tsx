import { DEMO_REPO_URL, IS_DEMO } from '@/lib/demo/config'

export const DEMO_BANNER_TEXT = 'Demonstração — dados fictícios, nada é guardado'

const BANNER_HEIGHT_PX = 28

// As páginas ocupam `h-screen`. Em vez de mexer em cada uma, a demo empurra o
// body para baixo da faixa e encolhe `h-screen` na mesma medida.
const LAYOUT_CSS = `
  html.h-screen { height: 100vh !important; }
  body { margin-top: ${BANNER_HEIGHT_PX}px !important; }
  .h-screen { height: calc(100vh - ${BANNER_HEIGHT_PX}px) !important; }
`

export default function DemoBanner() {
  if (!IS_DEMO) return null
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LAYOUT_CSS }} />
      <div
        role="note"
        className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-[#00a884] px-3 text-xs font-medium text-white"
        style={{ height: BANNER_HEIGHT_PX }}
      >
        <span className="truncate">{DEMO_BANNER_TEXT}</span>
        <a
          href={DEMO_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 underline underline-offset-2 hover:no-underline"
        >
          Ver código no GitHub
        </a>
      </div>
    </>
  )
}

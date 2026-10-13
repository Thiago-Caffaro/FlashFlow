import { renderToStaticMarkup } from 'react-dom/server'
import { Zap } from 'lucide-react'
import SandboxTab from '@/components/sandbox/sandbox-tab'
import SandboxQuickWindow from '@/components/sandbox/sandbox-quick-window'

// As abas completas (canvas do React Flow importa CSS) não são o alvo aqui.
jest.mock('@/components/flows/flows-tab', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/sidebar-right/triggers-tab', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/memory/memory-tab', () => ({ __esModule: true, default: () => null }))

describe('SandboxTab', () => {
  it('renders the sub-tabs and the overview without mounting the heavy tabs', () => {
    const html = renderToStaticMarkup(<SandboxTab active={false} />)

    for (const label of ['Visão geral', 'Gatilhos', 'Fluxos', 'Memória', 'Simular pedido', 'Produtos fictícios']) {
      expect(html).toContain(label)
    }
    // Nada é montado antes da primeira ativação — nem a visão geral, que
    // carregaria gatilhos, fluxos e memória.
    expect(html).not.toContain('Conta de testes isolada')
    expect(html).toContain('Conversa de teste')
  })
})

describe('SandboxQuickWindow', () => {
  it('shows the empty state as a shortcut when there are no items', () => {
    const html = renderToStaticMarkup(
      <SandboxQuickWindow title="Gatilhos" Icon={Zap} count={0} loading={false} emptyText="Nenhum gatilho" onOpen={() => {}}>
        <span>child-xyz</span>
      </SandboxQuickWindow>,
    )
    expect(html).toContain('Nenhum gatilho')
    expect(html).not.toContain('child-xyz')
  })

  it('shows count, warning and items', () => {
    const html = renderToStaticMarkup(
      <SandboxQuickWindow title="Gatilhos" Icon={Zap} count={2} loading={false} emptyText="Nenhum" warning="Sem gatilho de mensagem" onOpen={() => {}}>
        <span>meu gatilho</span>
      </SandboxQuickWindow>,
    )
    expect(html).toContain('>2<')
    expect(html).toContain('Sem gatilho de mensagem')
    expect(html).toContain('meu gatilho')
  })
})

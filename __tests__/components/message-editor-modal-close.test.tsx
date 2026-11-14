/** @jest-environment jsdom */
import type { ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import MessageEditorModal from '@/components/flows/message-editor-modal'
import type { FlowNode } from '@/types'

const node: FlowNode = {
  id: 'message',
  type: 'sendMessage',
  position: { x: 0, y: 0 },
  data: { message: 'Texto original' },
}

// Renderiza e deixa os fetches iniciais (variáveis, contas) resolverem dentro de act()
async function renderAsync(ui: ReactElement): Promise<RenderResult> {
  let result!: RenderResult
  await act(async () => {
    result = render(ui)
  })
  return result
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, variables: [], accounts: [] }),
  })) as unknown as typeof fetch
})
afterEach(cleanup)

async function setup() {
  const onChange = jest.fn()
  const onClose = jest.fn()
  const view = await renderAsync(
    <MessageEditorModal node={node} instanceName="wa-1" onChange={onChange} onClose={onClose} />
  )
  fireEvent.change(screen.getByDisplayValue('Texto original'), { target: { value: 'Texto editado' } })
  return { onChange, onClose, view }
}

describe('MessageEditorModal — fechar não é salvar', () => {
  it('Cancelar fecha sem gravar', async () => {
    const { onChange, onClose } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('o X do cabeçalho fecha sem gravar', async () => {
    const { onChange, onClose } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicar fora do modal fecha sem gravar', async () => {
    const { onChange, onClose } = await setup()
    fireEvent.click(screen.getByTestId('message-editor-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicar dentro do modal não o fecha', async () => {
    const { onClose } = await setup()
    fireEvent.click(screen.getByText('Editar Mensagem'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('desmontar o modal não grava', async () => {
    const { onChange, view } = await setup()
    view.unmount()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Salvar grava as alterações e fecha', async () => {
    const { onChange, onClose } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('message', expect.objectContaining({ message: 'Texto editado' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

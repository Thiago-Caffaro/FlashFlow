import { findFirstMessagesWithoutTemplate } from '@/lib/flow-template-lint'
import type { FlowEdge, FlowNode } from '@/types'

function node(id: string, type: FlowNode['type'], data: FlowNode['data'] = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data }
}

function edge(source: string, target: string): FlowEdge {
  return { id: `${source}-${target}`, source, target }
}

describe('findFirstMessagesWithoutTemplate', () => {
  it('flags the first free-text message of the flow', () => {
    const nodes = [node('start', 'start'), node('m1', 'sendMessage', { message: 'Olá, confirmando seu pedido' }), node('end', 'end')]
    const edges = [edge('start', 'm1'), edge('m1', 'end')]

    expect(findFirstMessagesWithoutTemplate(nodes, edges)).toEqual([
      { nodeId: 'm1', preview: 'Olá, confirmando seu pedido' },
    ])
  })

  it('does not flag a first message that has a fallback template or is in template mode', () => {
    const nodes = [
      node('start', 'start'),
      node('cond', 'condition'),
      node('m1', 'sendMessage', { message: 'Oi', fallbackTemplateId: 'tpl-1' }),
      node('m2', 'sendMessage', { templateId: 'tpl-2' }),
    ]
    const edges = [edge('start', 'cond'), edge('cond', 'm1'), edge('cond', 'm2')]

    expect(findFirstMessagesWithoutTemplate(nodes, edges)).toEqual([])
  })

  it('only checks the first message of each path — later messages run after the customer replied', () => {
    const nodes = [
      node('start', 'start'),
      node('m1', 'sendMessage', { message: 'Confirma?', fallbackTemplateId: 'tpl-1' }),
      node('m2', 'sendMessage', { message: 'Obrigado!' }),
    ]
    const edges = [edge('start', 'm1'), edge('m1', 'm2')]

    expect(findFirstMessagesWithoutTemplate(nodes, edges)).toEqual([])
  })

  it('checks each branch separately and walks through non-message nodes', () => {
    const nodes = [
      node('start', 'start'),
      node('switch', 'switchCase'),
      node('a', 'sendMessage', { message: 'Ramo A' }),
      node('b', 'sendMessage', { message: 'Ramo B', fallbackTemplateId: 'tpl-1' }),
    ]
    const edges = [edge('start', 'switch'), edge('switch', 'a'), edge('switch', 'b')]

    expect(findFirstMessagesWithoutTemplate(nodes, edges).map((item) => item.nodeId)).toEqual(['a'])
  })

  it('ignores empty message nodes and survives loops and unreachable nodes', () => {
    const nodes = [
      node('start', 'start'),
      node('empty', 'sendMessage', {}),
      node('loop', 'condition'),
      node('orphan', 'sendMessage', { message: 'Nunca alcançada' }),
    ]
    const edges = [edge('start', 'loop'), edge('loop', 'loop'), edge('loop', 'empty')]

    expect(findFirstMessagesWithoutTemplate(nodes, edges)).toEqual([])
  })

  it('describes an image-only first message', () => {
    const nodes = [node('start', 'start'), node('m1', 'sendMessage', { images: [{ id: 'i', url: 'u', filename: 'f' }] })]

    expect(findFirstMessagesWithoutTemplate(nodes, [edge('start', 'm1')])).toEqual([
      { nodeId: 'm1', preview: 'Mensagem só com imagem' },
    ])
  })
})

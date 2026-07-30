import { buildReplyCasesForConnection } from '@/lib/flow-switch-cases'
import type { FlowNode } from '@/types'

const nodes: FlowNode[] = [
  {
    id: 'message',
    type: 'sendMessage',
    position: { x: 0, y: 0 },
    data: {
      replyButtons: [
        { id: 'confirm', label: 'CONFIRMAR PEDIDO' },
        { id: 'change', label: 'MODIFICAR DADOS' },
      ],
    },
  },
  {
    id: 'switch',
    type: 'switchCase',
    position: { x: 0, y: 0 },
    data: { cases: [] },
  },
  {
    id: 'end',
    type: 'end',
    position: { x: 0, y: 0 },
    data: {},
  },
]

describe('reply button Switch Case generation', () => {
  it('creates exact cases for every reply button', () => {
    expect(buildReplyCasesForConnection(nodes, 'message', 'switch')).toEqual([
      { id: 'reply-confirm', conditionType: 'exact', value: 'CONFIRMAR PEDIDO' },
      { id: 'reply-change', conditionType: 'exact', value: 'MODIFICAR DADOS' },
    ])
  })

  it('does not change unrelated connections', () => {
    expect(buildReplyCasesForConnection(nodes, 'message', 'end')).toBeNull()
    expect(buildReplyCasesForConnection(nodes, 'end', 'switch')).toBeNull()
  })
})

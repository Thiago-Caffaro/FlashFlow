import { findReplyConnectionIssue } from '@/lib/flow-connection-validation'
import type { FlowEdge, FlowNode } from '@/types'

function messageNode(replyButtons: FlowNode['data']['replyButtons']): FlowNode {
  return {
    id: 'message',
    type: 'sendMessage',
    position: { x: 0, y: 0 },
    data: { replyButtons },
  }
}

const switchNode: FlowNode = {
  id: 'switch',
  type: 'switchCase',
  position: { x: 0, y: 0 },
  data: { cases: [] },
}

describe('reply connection validation', () => {
  it('reports the message node before saving when replies are not connected to a Switch Case', () => {
    const nodes = [
      messageNode([{ id: 'confirm', label: 'CONFIRMAR' }]),
      { ...switchNode, type: 'end' as const },
    ]
    const edges: FlowEdge[] = [{ id: 'e1', source: 'message', target: 'switch' }]

    expect(findReplyConnectionIssue(nodes, edges)).toMatchObject({
      nodeId: 'message',
      error: expect.stringContaining('Switch Case'),
    })
  })

  it('accepts one direct connection to a Switch Case', () => {
    const nodes = [
      messageNode([{ id: 'confirm', label: 'CONFIRMAR' }]),
      switchNode,
    ]
    const edges: FlowEdge[] = [{ id: 'e1', source: 'message', target: 'switch' }]

    expect(findReplyConnectionIssue(nodes, edges)).toBeNull()
  })
})

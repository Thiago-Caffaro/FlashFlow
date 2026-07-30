import type { FlowEdge, FlowNode } from '@/types'

export interface FlowConnectionIssue {
  nodeId: string
  error: string
}

export function findReplyConnectionIssue(
  nodes: FlowNode[],
  edges: FlowEdge[]
): FlowConnectionIssue | null {
  const nodeTypes = new Map(nodes.map((node) => [node.id, node.type]))

  for (const node of nodes) {
    if (node.type !== 'sendMessage' || !Array.isArray(node.data.replyButtons)) continue
    if (node.data.replyButtons.length === 0) continue

    const outgoing = edges.filter((edge) => edge.source === node.id)
    if (outgoing.length !== 1 || nodeTypes.get(outgoing[0].target) !== 'switchCase') {
      return {
        nodeId: node.id,
        error: 'Uma mensagem com respostas deve ter uma única conexão direta para um Switch Case.',
      }
    }
  }

  return null
}

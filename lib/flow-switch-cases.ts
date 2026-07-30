import type { FlowNode, SwitchCase } from '@/types'

export function buildReplyCasesForConnection(
  nodes: FlowNode[],
  sourceId: string | null,
  targetId: string | null
): SwitchCase[] | null {
  if (!sourceId || !targetId) return null

  const source = nodes.find((node) => node.id === sourceId)
  const target = nodes.find((node) => node.id === targetId)
  if (source?.type !== 'sendMessage' || target?.type !== 'switchCase') return null

  const buttons = Array.isArray(source.data.replyButtons) ? source.data.replyButtons : []
  if (buttons.length === 0) return null

  return buttons.map((button) => ({
    id: `reply-${button.id}`,
    conditionType: 'exact',
    value: button.label,
  }))
}

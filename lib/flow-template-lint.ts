import type { FlowEdge, FlowNode } from '@/types'

export interface FirstMessageWithoutTemplate {
  nodeId: string
  preview: string
}

// Numa conta Cloud API, a primeira mensagem de um fluxo iniciado pelo sistema
// (pedido, checkout abandonado) só chega ao cliente como template — texto
// livre só passa dentro de 24h da última resposta dele. Aponta as primeiras
// mensagens de cada caminho a partir do início que não têm template nem
// template de fallback. Mensagens seguintes ficam de fora: quando o fluxo
// chega nelas, o cliente já respondeu e a janela está aberta.
export function findFirstMessagesWithoutTemplate(nodes: FlowNode[], edges: FlowEdge[]): FirstMessageWithoutTemplate[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const result: FirstMessageWithoutTemplate[] = []
  const visited = new Set<string>()
  const queue = ['start']

  while (queue.length > 0) {
    const currentId = queue.shift() as string
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const node = nodeById.get(currentId)
    if (!node) continue

    if (node.type === 'sendMessage') {
      const hasTemplate = Boolean(node.data.templateId) || Boolean(node.data.fallbackTemplateId)
      const message = typeof node.data.message === 'string' ? node.data.message.trim() : ''
      const hasImages = Array.isArray(node.data.images) && node.data.images.length > 0
      if (!hasTemplate && (message || hasImages)) {
        result.push({ nodeId: node.id, preview: message ? message.slice(0, 50) : 'Mensagem só com imagem' })
      }
      // Este caminho já tem sua mensagem inicial — o que vem depois só roda
      // depois de o cliente responder.
      continue
    }

    queue.push(...(outgoing.get(currentId) ?? []))
  }

  return result
}

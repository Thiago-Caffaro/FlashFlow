import 'server-only'
import type { FlowEdge, FlowNode } from '@/types'

const MAX_NODES = 200
const MAX_EDGES = 400
const MAX_NODE_DATA_JSON_LENGTH = 20000 // limite generoso para prompts de IA e textos de mensagem

const KNOWN_NODE_TYPES = new Set<string>([
  'start',
  'sendMessage',
  'condition',
  'switchCase',
  'aiAssistant',
  'fulfillmentStock',
  'fulfillmentStatus',
  'end',
])

export interface FlowValidationResult {
  ok: boolean
  error?: string
}

/**
 * Validação estrutural do grafo de um fluxo antes de salvar. Não tenta
 * reescrever ou "corrigir" o grafo — apenas rejeita formas que não podem ser
 * executadas com segurança pelo motor (lib/flow-engine.ts): tipos de nó
 * desconhecidos, ids duplicados, arestas para nós inexistentes, tamanho
 * excessivo, ou mais de um nó de início.
 *
 * Um fluxo recém-criado começa vazio (nodes: [], edges: []) — isso é válido
 * de propósito, pois o editor visual popula o grafo depois via PUT.
 */
export function validateFlowJson(json: unknown): FlowValidationResult {
  if (typeof json !== 'object' || json === null) {
    return { ok: false, error: 'json do fluxo deve ser um objeto' }
  }

  const { nodes, edges } = json as { nodes?: unknown; edges?: unknown }

  if (!Array.isArray(nodes)) return { ok: false, error: 'nodes deve ser um array' }
  if (!Array.isArray(edges)) return { ok: false, error: 'edges deve ser um array' }
  if (nodes.length > MAX_NODES) return { ok: false, error: `fluxo excede o limite de ${MAX_NODES} nós` }
  if (edges.length > MAX_EDGES) return { ok: false, error: `fluxo excede o limite de ${MAX_EDGES} conexões` }

  const seenNodeIds = new Set<string>()
  let startNodeCount = 0

  for (const raw of nodes) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'nó inválido' }
    const node = raw as Partial<FlowNode>

    if (typeof node.id !== 'string' || !node.id) return { ok: false, error: 'nó sem id válido' }
    if (seenNodeIds.has(node.id)) return { ok: false, error: `id de nó duplicado: ${node.id}` }
    seenNodeIds.add(node.id)

    if (typeof node.type !== 'string' || !KNOWN_NODE_TYPES.has(node.type)) {
      return { ok: false, error: `tipo de nó desconhecido: ${String(node.type)}` }
    }
    if (node.type === 'start') startNodeCount++

    if (node.data !== undefined) {
      let dataLength = 0
      try {
        dataLength = JSON.stringify(node.data).length
      } catch {
        return { ok: false, error: `dados do nó "${node.id}" não são serializáveis` }
      }
      if (dataLength > MAX_NODE_DATA_JSON_LENGTH) {
        return { ok: false, error: `dados do nó "${node.id}" excedem o tamanho máximo permitido` }
      }
    }
  }

  if (startNodeCount > 1) {
    return { ok: false, error: 'fluxo não pode ter mais de um nó de início' }
  }

  const seenEdgeIds = new Set<string>()
  for (const raw of edges) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'conexão inválida' }
    const edge = raw as Partial<FlowEdge>

    if (typeof edge.id === 'string' && edge.id) {
      if (seenEdgeIds.has(edge.id)) return { ok: false, error: `id de conexão duplicado: ${edge.id}` }
      seenEdgeIds.add(edge.id)
    }

    if (typeof edge.source !== 'string' || !seenNodeIds.has(edge.source)) {
      return { ok: false, error: `conexão referencia nó de origem inexistente: ${String(edge.source)}` }
    }
    if (typeof edge.target !== 'string' || !seenNodeIds.has(edge.target)) {
      return { ok: false, error: `conexão referencia nó de destino inexistente: ${String(edge.target)}` }
    }
  }

  return { ok: true }
}

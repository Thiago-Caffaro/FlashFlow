import 'server-only'
import type { FlowEdge, FlowNode } from '@/types'
import { getMessagePlaceholders, validateMessagePlaceholders } from './message-template'
import { findReplyConnectionIssue } from './flow-connection-validation'

const MAX_NODES = 200
const MAX_EDGES = 400
const MAX_NODE_DATA_JSON_LENGTH = 20000

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

function messageTemplates(node: FlowNode): string[] {
  return [
    typeof node.data.messageTitle === 'string' ? node.data.messageTitle : '',
    typeof node.data.message === 'string' ? node.data.message : '',
    typeof node.data.footer === 'string' ? node.data.footer : '',
    ...(Array.isArray(node.data.replyButtons)
      ? node.data.replyButtons.map((button) => (
        button && typeof button === 'object' && typeof button.label === 'string' ? button.label : ''
      ))
      : []),
  ]
}

export function getFlowCustomVariableKeys(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const nodes = (json as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return []
  const keys = new Set<string>()
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as FlowNode
    if (node.type !== 'sendMessage' || !node.data) continue
    for (const placeholder of getMessagePlaceholders(...messageTemplates(node))) {
      if (placeholder.startsWith('personalizada.')) {
        keys.add(placeholder.slice('personalizada.'.length))
      }
    }
  }
  return [...keys]
}

export function validateFlowMessagePlaceholders(
  json: unknown,
  customKeys: Iterable<string>
): FlowValidationResult {
  if (!json || typeof json !== 'object') {
    return { ok: false, error: 'json do fluxo deve ser um objeto' }
  }
  const nodes = (json as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return { ok: false, error: 'nodes deve ser um array' }
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as FlowNode
    if (node.type !== 'sendMessage' || !node.data) continue
    const validation = validateMessagePlaceholders(messageTemplates(node), customKeys)
    if (!validation.ok) {
      return { ok: false, error: `${validation.error} no no "${node.id}"` }
    }
  }
  return { ok: true }
}

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

      if (node.type === 'sendMessage') {
        const data = node.data as FlowNode['data']
        if (
          data.combineImageAndMessage !== undefined
          && typeof data.combineImageAndMessage !== 'boolean'
        ) {
          return { ok: false, error: `opcao de imagem do no "${node.id}" deve ser booleana` }
        }
        if (data.replyButtons !== undefined && !Array.isArray(data.replyButtons)) {
          return { ok: false, error: `respostas do no "${node.id}" devem ser um array` }
        }
        const buttons = Array.isArray(data.replyButtons) ? data.replyButtons : []
        if (buttons.length > 3) {
          return { ok: false, error: `mensagem do no "${node.id}" excede o limite de 3 respostas` }
        }
        const buttonIds = new Set<string>()
        for (const button of buttons) {
          if (!button || typeof button !== 'object') {
            return { ok: false, error: `resposta invalida no no "${node.id}"` }
          }
          if (typeof button.id !== 'string' || !button.id.trim() || buttonIds.has(button.id)) {
            return { ok: false, error: `resposta com id invalido ou duplicado no no "${node.id}"` }
          }
          if (typeof button.label !== 'string' || !button.label.trim() || button.label.trim().length > 80) {
            return { ok: false, error: `texto de resposta invalido no no "${node.id}"` }
          }
          buttonIds.add(button.id)
        }
      }
    }
  }

  if (startNodeCount > 1) {
    return { ok: false, error: 'fluxo não pode ter mais de um nó de início' }
  }

  const seenEdgeIds = new Set<string>()
  for (const raw of edges) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'conexao invalida' }
    const edge = raw as Partial<FlowEdge>
    if (typeof edge.id === 'string' && edge.id) {
      if (seenEdgeIds.has(edge.id)) return { ok: false, error: `id de conexao duplicado: ${edge.id}` }
      seenEdgeIds.add(edge.id)
    }
    if (typeof edge.source !== 'string' || !seenNodeIds.has(edge.source)) {
      return { ok: false, error: `conexao referencia no de origem inexistente: ${String(edge.source)}` }
    }
    if (typeof edge.target !== 'string' || !seenNodeIds.has(edge.target)) {
      return { ok: false, error: `conexao referencia no de destino inexistente: ${String(edge.target)}` }
    }
  }

  const connectionIssue = findReplyConnectionIssue(nodes as FlowNode[], edges as FlowEdge[])
  if (connectionIssue) {
    return {
      ok: false,
      error: `${connectionIssue.error} Nó: "${connectionIssue.nodeId}".`,
    }
  }

  return { ok: true }
}

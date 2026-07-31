import type { Flow, FlowNode, MessageVariable } from '@/types'
import { getMessagePlaceholders } from './message-template'

export interface FlowTransferVariable {
  key: string
  label: string
  value: string
}

export interface FlowTransferItem {
  name?: string
  ativo?: boolean
  json: Flow['json']
}

export interface ParsedFlowTransfer {
  flows: FlowTransferItem[]
  variables: FlowTransferVariable[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItem(value: unknown): FlowTransferItem | null {
  if (!isRecord(value) || !isRecord(value.json)) return null
  const json = value.json as Record<string, unknown>
  if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) return null
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    ativo: typeof value.ativo === 'boolean' ? value.ativo : undefined,
    json: value.json as Flow['json'],
  }
}

function parseVariables(value: unknown): FlowTransferVariable[] {
  if (!Array.isArray(value)) return []
  const variables: FlowTransferVariable[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const variableValue = typeof raw.value === 'string' ? raw.value : ''
    if (!key || !label || seen.has(key)) continue
    variables.push({ key, label, value: variableValue })
    seen.add(key)
  }
  return variables
}

export function parseFlowTransfer(value: unknown): ParsedFlowTransfer {
  if (!isRecord(value)) throw new Error('Arquivo invalido. Use um JSON exportado pelo FlashFlow.')

  let flows: FlowTransferItem[]
  if (value.flashflow_export === 'flow') {
    const item = parseItem(value)
    if (!item) throw new Error('O arquivo nao contem um fluxo valido.')
    flows = [item]
  } else if (value.flashflow_export === 'flows') {
    if (!Array.isArray(value.flows) || value.flows.length === 0) {
      throw new Error('O arquivo nao contem fluxos para importar.')
    }
    flows = value.flows.map(parseItem).filter((item): item is FlowTransferItem => Boolean(item))
    if (flows.length !== value.flows.length) {
      throw new Error('Um ou mais fluxos do arquivo possuem formato invalido.')
    }
  } else {
    throw new Error('Arquivo invalido. Use um JSON exportado pelo FlashFlow.')
  }

  return { flows, variables: parseVariables(value.variables) }
}

function nodeTemplates(node: FlowNode): string[] {
  return [
    typeof node.data.messageTitle === 'string' ? node.data.messageTitle : '',
    typeof node.data.message === 'string' ? node.data.message : '',
    typeof node.data.footer === 'string' ? node.data.footer : '',
    typeof node.data.notificationMessage === 'string' ? node.data.notificationMessage : '',
    ...(Array.isArray(node.data.replyButtons)
      ? node.data.replyButtons.map((button) => button.label)
      : []),
  ]
}

export function getReferencedCustomVariableKeys(flows: FlowTransferItem[]): string[] {
  const keys = new Set<string>()
  for (const flow of flows) {
    for (const node of flow.json.nodes) {
      for (const placeholder of getMessagePlaceholders(...nodeTemplates(node))) {
        if (placeholder.startsWith('personalizada.')) {
          keys.add(placeholder.slice('personalizada.'.length))
        }
      }
    }
  }
  return [...keys]
}

export function selectTransferVariables(
  flows: FlowTransferItem[],
  variables: MessageVariable[]
): FlowTransferVariable[] {
  const referenced = new Set(getReferencedCustomVariableKeys(flows))
  return variables
    .filter((variable) => referenced.has(variable.key))
    .map(({ key, label, value }) => ({ key, label, value }))
}

import type { Flow, FlowNode, FlowReplyButton, Message, Trigger } from '@/types'
import { buildMessageTemplateValues, renderMessageTemplate } from '@/lib/message-template'
import { isOrderStateField } from '@/lib/order-state'
import { nowIso } from './clock'
import { nextId, type DemoStore } from './store'

// Mini-motor de fluxos da demo. O motor real (lib/flow-engine.ts) corre no
// servidor, com Supabase, filas e provedores de IA. Este percorre o mesmo
// JSON de fluxo no browser, o suficiente para o chat do Sandbox mostrar o
// fluxo desenhado a funcionar: mensagens, botões, switch/case, condição,
// notificações e captura de estado do pedido. As respostas de IA são simuladas.

export interface SandboxRun {
  flowId: string
  /** Node onde o fluxo está parado à espera do cliente. */
  nodeId: string
  waiting: 'reply' | 'ai'
  buttons: FlowReplyButton[]
  orderId?: string
  checkoutId?: string
  aiTurns: number
}

interface RunContext {
  orderId?: string
  checkoutId?: string
}

const MAX_STEPS = 60
const PLACEHOLDER = /\{\{\s*[^{}]+?\s*\}\}/g

const AI_REPLIES = [
  'Claro! Posso ajudar com prazos de entrega, pagamento na entrega ou trocas. O que precisa de saber?',
  'A entrega demora 24 a 48 horas úteis e o pagamento é feito ao estafeta, em dinheiro ou multibanco.',
  'Tem 14 dias para devolver sem custos, basta responder a esta conversa.',
  'Fico por aqui se precisar de mais alguma coisa 🙂',
]

const AI_DISCLAIMER = '\n\n(Resposta simulada: na aplicação real, este bloco chama o modelo de IA configurado.)'

function emit(store: DemoStore, conversationId: string, content: string, sender: Message['sender_type'], type = 'text'): void {
  store.sandboxMessages.push({
    id: nextId(store, 'sbx-msg'),
    conversation_id: conversationId,
    wa_message_id: null,
    content,
    type,
    direction: sender === null ? 'inbound' : 'outbound',
    status: sender === null ? 'received' : 'sent',
    sender_type: sender,
    created_at: nowIso(),
  })
}

function render(store: DemoStore, flow: Flow, conversationId: string, context: RunContext, template: string): string {
  const contact = store.sandboxContacts.find((c) => c.id === conversationId)
  const order = context.orderId ? store.orders.find((o) => o.id === context.orderId) ?? null : null
  const checkout = context.checkoutId ? store.abandonedCheckouts.find((c) => c.id === context.checkoutId) ?? null : null
  const customVariables: Record<string, string> = {}
  for (const variable of store.messageVariables) {
    if (variable.instance_name === flow.instance_name) customVariables[variable.key] = variable.value
  }
  const values = buildMessageTemplateValues({
    contact: {
      name: order?.customer_name ?? checkout?.customer_name ?? contact?.contact_name ?? null,
      number: contact?.contact_phone ?? '',
    },
    order,
    checkout,
    customVariables,
  })
  try {
    return renderMessageTemplate(template, values)
  } catch {
    // Variável sem valor neste contexto (ex.: {{pedido.numero}} sem pedido):
    // o motor real recusaria o envio; na demo mostra-se um traço.
    return template.replace(PLACEHOLDER, (match) => {
      const value = values[match.slice(2, -2).trim()]
      return value?.trim() ? value : '—'
    })
  }
}

const nextOf = (flow: Flow, nodeId: string, handle?: string): string | null => {
  const edge = flow.json.edges.find((e) => e.source === nodeId && (handle === undefined || e.sourceHandle === handle))
  return edge?.target ?? null
}

function matches(type: 'contains' | 'exact' | undefined, expected: string | undefined, input: string): boolean {
  const value = (expected ?? '').trim().toLowerCase()
  const text = input.trim().toLowerCase()
  if (!value) return false
  if (value === '*') return text.length > 0
  return type === 'exact' ? text === value : text.includes(value)
}

function aiReply(store: DemoStore, conversationId: string, run: Pick<SandboxRun, 'aiTurns'>): void {
  const reply = AI_REPLIES[Math.min(run.aiTurns, AI_REPLIES.length - 1)]
  emit(store, conversationId, run.aiTurns === 0 ? `${reply}${AI_DISCLAIMER}` : reply, 'ai')
}

/** Percorre o fluxo a partir de `nodeId` até precisar do cliente ou terminar. */
function advance(
  store: DemoStore,
  conversationId: string,
  flow: Flow,
  startNodeId: string | null,
  context: RunContext,
  initialInput?: string,
): void {
  let nodeId = startNodeId
  let input = initialInput
  const wait = (node: FlowNode, waiting: SandboxRun['waiting'], buttons: FlowReplyButton[] = [], aiTurns = 0) => {
    store.sandboxRuns[conversationId] = { flowId: flow.id, nodeId: node.id, waiting, buttons, aiTurns, ...context }
  }
  delete store.sandboxRuns[conversationId]

  for (let step = 0; step < MAX_STEPS && nodeId; step++) {
    const current: FlowNode | undefined = flow.json.nodes.find((n) => n.id === nodeId)
    if (!current) return
    const data = current.data ?? {}

    switch (current.type) {
      case 'sendMessage': {
        for (const image of data.images ?? []) emit(store, conversationId, image.url, 'flow', 'image')
        const text = [data.messageTitle ? `*${data.messageTitle}*` : '', data.message ?? '', data.footer ?? '']
          .filter((part) => part.trim())
          .map((part) => render(store, flow, conversationId, context, part))
          .join('\n\n')
        if (text) emit(store, conversationId, text, 'flow')
        const buttons = data.replyButtons ?? []
        if (buttons.length > 0) {
          const target = flow.json.nodes.find((n) => n.id === nextOf(flow, current.id))
          if (target) wait(target, 'reply', buttons)
          return
        }
        nodeId = nextOf(flow, current.id)
        break
      }
      case 'switchCase': {
        if (input === undefined) {
          wait(current, 'reply')
          return
        }
        const text = input
        const index = (data.cases ?? []).findIndex((item) => matches(item.conditionType, item.value, text))
        input = undefined
        nodeId = nextOf(flow, current.id, index >= 0 ? `case-${index}` : 'default')
        break
      }
      case 'condition': {
        if (input === undefined) {
          wait(current, 'reply')
          return
        }
        nodeId = nextOf(flow, current.id, matches(data.conditionType, data.conditionValue, input) ? 'true' : 'false')
        break
      }
      case 'notify': {
        store.notifications.unshift({
          id: nextId(store, 'notif'),
          instance_name: flow.instance_name,
          type: 'flow',
          title: `Fluxo "${flow.name}"`,
          message: render(store, flow, conversationId, context, data.notificationMessage ?? 'O fluxo pediu atenção de um operador.'),
          conversation_id: null,
          flow_id: flow.id,
          flow_node_id: current.id,
          source_key: null,
          metadata: {},
          read_at: null,
          dismissed_at: null,
          created_at: nowIso(),
        })
        nodeId = nextOf(flow, current.id)
        break
      }
      case 'captureOrderData': {
        const order = context.orderId ? store.orders.find((o) => o.id === context.orderId) : undefined
        if (order && isOrderStateField(data.orderStateField) && typeof data.orderStateValue === 'string') {
          Object.assign(order, { [data.orderStateField]: data.orderStateValue, updated_at: nowIso() })
          if (data.orderStateField === 'commercial_status' && data.orderStateValue.startsWith('Confirmado')) {
            order.confirmed_at = nowIso()
            order.confirmation_status_updated_at = order.confirmed_at
          }
        }
        nodeId = nextOf(flow, current.id)
        break
      }
      case 'aiAssistant': {
        aiReply(store, conversationId, { aiTurns: 0 })
        wait(current, 'ai', [], 1)
        return
      }
      case 'slackNotify': {
        // Transferência para humano encerra o fluxo; sem Slack na demo.
        nodeId = data.slackHandoff ? null : nextOf(flow, current.id)
        break
      }
      case 'end':
        return
      default:
        nodeId = nextOf(flow, current.id)
    }
  }
}

/** Arranca um fluxo do início na conversa de teste. */
export function startSandboxFlow(store: DemoStore, conversationId: string, flow: Flow, context: RunContext = {}, input?: string): void {
  const start = flow.json.nodes.find((n) => n.type === 'start')
  advance(store, conversationId, flow, start ? nextOf(flow, start.id) : null, context, input)
}

/** Fluxos ativos ligados a gatilhos da conta sandbox para a origem indicada. */
export function sandboxFlowsFor(store: DemoStore, instanceName: string, source: Trigger['source']): Flow[] {
  return store.triggers
    .filter((t) => t.instance_name === instanceName && t.source === source && t.action === 'flow')
    .map((t) => store.flows.find((f) => f.id === t.action_payload.flow_id && f.ativo))
    .filter((flow): flow is Flow => flow !== undefined)
}

/** Mensagem do "cliente" no chat de teste: continua o fluxo em curso ou dispara um gatilho. */
export function handleSandboxInbound(store: DemoStore, conversationId: string, instanceName: string, text: string): void {
  emit(store, conversationId, text, null)
  const run = store.sandboxRuns[conversationId]
  const flow = run ? store.flows.find((f) => f.id === run.flowId) : undefined

  if (run && flow) {
    if (run.waiting === 'ai') {
      aiReply(store, conversationId, run)
      run.aiTurns += 1
      return
    }
    advance(store, conversationId, flow, run.nodeId, { orderId: run.orderId, checkoutId: run.checkoutId }, text)
    return
  }
  delete store.sandboxRuns[conversationId]

  const trigger = store.triggers.find((t) => t.instance_name === instanceName && t.source === 'message' && matches(t.tipo, t.valor, text))
  if (!trigger) return
  if (trigger.action === 'send_message') {
    const message = trigger.action_payload.message
    if (message) emit(store, conversationId, message, 'flow')
    return
  }
  const target = store.flows.find((f) => f.id === trigger.action_payload.flow_id && f.ativo)
  if (target) startSandboxFlow(store, conversationId, target, {}, text)
}

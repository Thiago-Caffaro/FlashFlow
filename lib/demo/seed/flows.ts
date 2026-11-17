import type { Flow, FlowEdge, FlowMedia, FlowNode, FlowNodeData, FlowNodeType, Trigger } from '@/types'
import { minutesAgo } from '../clock'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from './accounts'
import { FLOW_AI_ID, FLOW_AI_NODE_ID, FLOW_CART_ID, FLOW_COD_ID } from './ids'
import { demoImage } from './images'

const node = (id: string, type: FlowNodeType, x: number, y: number, data: FlowNodeData = {}): FlowNode =>
  ({ id, type, position: { x, y }, data })

const edge = (source: string, target: string, sourceHandle?: string): FlowEdge =>
  ({ id: `e-${source}-${sourceHandle ?? 'out'}-${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: null })

// Modelo de template aprovado usado pela conta oficial (ver seedTemplates).
export const TEMPLATE_CONFIRMACAO_ID = 'tpl-confirmacao-encomenda'
export const TEMPLATE_CARRINHO_ID = 'tpl-carrinho-abandonado'

function codFlow(): Flow {
  const nodes: FlowNode[] = [
    node('start', 'start', 320, 0, { label: 'Novo pedido (Shopify)' }),
    node('msg-confirma', 'sendMessage', 320, 130, {
      label: 'Pedir confirmação',
      message: 'Hola {{nome}} 👋 Hemos recibido tu pedido {{pedido}}: {{produtos}} ({{total}}), pago contra reembolso.\n\n¿Confirmas la dirección: {{endereco}}?',
      replyButtons: [
        { id: 'btn-si', label: 'Sí, confirmo' },
        { id: 'btn-cambiar', label: 'Cambiar dirección' },
      ],
    }),
    node('switch', 'switchCase', 320, 330, {
      label: 'Resposta do cliente',
      cases: [
        { id: 'case-si', conditionType: 'contains', value: 'sí' },
        { id: 'case-cambiar', conditionType: 'contains', value: 'cambiar' },
      ],
    }),
    node('estado-confirmado', 'captureOrderData', 40, 540, {
      label: 'Marcar como confirmado',
      orderStateField: 'commercial_status',
      orderStateValue: 'Confirmado WhatsApp',
    }),
    node('msg-ok', 'sendMessage', 40, 700, {
      label: 'Confirmado',
      message: '¡Perfecto! Tu pedido queda confirmado ✅ Te avisaremos cuando salga del almacén.',
    }),
    node('notify-morada', 'notify', 320, 540, {
      label: 'Avisar operador',
      notificationMessage: '{{nome}} quer alterar a morada do pedido {{pedido}}.',
    }),
    node('msg-morada', 'sendMessage', 320, 700, {
      label: 'Pedir nova morada',
      message: 'Sin problema. Escríbeme la dirección completa y un compañero la actualiza enseguida.',
    }),
    node('ia-duvidas', 'aiAssistant', 600, 540, {
      label: 'IA tira dúvidas',
      systemPrompt: 'És o assistente da loja Casa Brisa. Responde em espanhol, de forma breve, a dúvidas sobre o pedido contra-reembolso. Se o cliente quiser alterar ou cancelar, passa a um humano.',
      useDefaultModel: true,
      historyLimit: 20,
      temperature: 0.4,
      timeoutType: 'minutes',
      timeoutValue: 360,
      responseDelayMs: 5000,
    }),
    node('end', 'end', 320, 880, { label: 'Fim' }),
  ]
  const edges: FlowEdge[] = [
    edge('start', 'msg-confirma'),
    edge('msg-confirma', 'switch'),
    edge('switch', 'estado-confirmado', 'case-0'),
    edge('switch', 'notify-morada', 'case-1'),
    edge('switch', 'ia-duvidas', 'default'),
    edge('estado-confirmado', 'msg-ok'),
    edge('msg-ok', 'end'),
    edge('notify-morada', 'msg-morada'),
    edge('msg-morada', 'end'),
    edge('ia-duvidas', 'end'),
  ]
  return {
    id: FLOW_COD_ID, instance_name: DEMO_INSTANCE_ES, name: 'Confirmação de pedido COD',
    json: { nodes, edges }, ativo: true, managed_by_automation_id: null,
    created_at: minutesAgo(60_000), updated_at: minutesAgo(1_500),
  }
}

function aiFlow(): Flow {
  const nodes: FlowNode[] = [
    node('start', 'start', 300, 0, {
      label: 'Mensagem do cliente',
      sessionEndMessage: { enabled: true, text: 'Gracias por escribirnos. Si necesitas algo más, aquí estamos 💚' },
    }),
    node('cond-humano', 'condition', 300, 130, {
      label: 'Pede um humano?',
      conditionType: 'contains',
      conditionValue: 'humano',
    }),
    node('notify-humano', 'notify', 40, 320, {
      label: 'Avisar operador',
      notificationMessage: '{{nome}} pediu para falar com uma pessoa.',
    }),
    node('msg-humano', 'sendMessage', 40, 480, {
      label: 'Aviso ao cliente',
      message: 'Claro, te paso con una persona del equipo. En breve te escriben.',
    }),
    node(FLOW_AI_NODE_ID, 'aiAssistant', 560, 320, {
      label: 'Atendimento com IA',
      systemPrompt: 'És a assistente da Casa Brisa. Responde em espanhol sobre produtos, prazos de envio (24–48 h) e pagamento na entrega. Nunca inventes preços: usa os blocos de memória. Se não souberes, passa a um humano.',
      useDefaultModel: true,
      historyLimit: 20,
      temperature: 0.5,
      continueConversation: true,
      timeoutType: 'minutes',
      timeoutValue: 360,
      responseDelayMs: 5000,
      memoryBlockIds: ['mem-envios', 'mem-devolucoes'],
      inactivityMessage: '¿Sigues ahí? Si quieres, seguimos más tarde 🙂',
    }),
    node('end', 'end', 300, 660, { label: 'Fim' }),
  ]
  const edges: FlowEdge[] = [
    edge('start', 'cond-humano'),
    edge('cond-humano', 'notify-humano', 'true'),
    edge('cond-humano', FLOW_AI_NODE_ID, 'false'),
    edge('notify-humano', 'msg-humano'),
    edge('msg-humano', 'end'),
    edge(FLOW_AI_NODE_ID, 'end'),
  ]
  return {
    id: FLOW_AI_ID, instance_name: DEMO_INSTANCE_ES, name: 'Atendimento com IA',
    json: { nodes, edges }, ativo: true, managed_by_automation_id: null,
    created_at: minutesAgo(40_000), updated_at: minutesAgo(700),
  }
}

function cartFlow(): Flow {
  const nodes: FlowNode[] = [
    node('start', 'start', 300, 0, { label: 'Carrinho abandonado' }),
    node('msg-carrinho', 'sendMessage', 300, 130, {
      label: 'Lembrete do carrinho',
      message: 'Olá {{nome}}, reparámos que deixou {{produtos}} no carrinho 🛒 Posso ajudar a concluir a encomenda? O pagamento é feito só na entrega.',
      images: [{ id: 'img-almofada', url: demoImage('Almofada Brisa', '#00a884'), filename: 'almofada-brisa.svg' }],
      combineImageAndMessage: true,
      // Conta oficial: fora da janela de 24 h, o template aprovado entra no lugar do texto livre.
      fallbackTemplateId: TEMPLATE_CARRINHO_ID,
      fallbackTemplateVariableMap: { '1': 'nome', '2': 'produtos' },
      replyButtons: [
        { id: 'btn-quero', label: 'Quero concluir' },
        { id: 'btn-nao', label: 'Agora não' },
      ],
    }),
    node('switch', 'switchCase', 300, 360, {
      label: 'Resposta do cliente',
      cases: [
        { id: 'case-quero', conditionType: 'contains', value: 'quero' },
        { id: 'case-nao', conditionType: 'contains', value: 'não' },
      ],
    }),
    node('slack', 'slackNotify', 20, 570, {
      label: 'Avisar equipa no Slack',
      slackTitle: 'Carrinho recuperado',
      slackMessage: '{{nome}} quer concluir a encomenda de {{produtos}}.',
      slackMention: 'here',
      slackHandoff: true,
    }),
    node('msg-nao', 'sendMessage', 300, 570, {
      label: 'Despedida',
      message: 'Sem problema! Se mudar de ideias, é só responder a esta mensagem 🙂',
    }),
    node('ia', 'aiAssistant', 580, 570, {
      label: 'IA tira dúvidas',
      systemPrompt: 'És a assistente da Casa Brisa. Responde em português de Portugal a dúvidas sobre o produto do carrinho e incentiva a concluir a encomenda, sem pressionar.',
      useDefaultModel: true,
      historyLimit: 20,
      temperature: 0.5,
      timeoutType: 'messages',
      timeoutValue: 12,
      responseDelayMs: 4000,
    }),
    node('end', 'end', 300, 760, { label: 'Fim' }),
  ]
  const edges: FlowEdge[] = [
    edge('start', 'msg-carrinho'),
    edge('msg-carrinho', 'switch'),
    edge('switch', 'slack', 'case-0'),
    edge('switch', 'msg-nao', 'case-1'),
    edge('switch', 'ia', 'default'),
    edge('msg-nao', 'end'),
    edge('ia', 'end'),
  ]
  return {
    id: FLOW_CART_ID, instance_name: DEMO_INSTANCE_PT, name: 'Recuperação de carrinho abandonado',
    json: { nodes, edges }, ativo: true, managed_by_automation_id: null,
    created_at: minutesAgo(30_000), updated_at: minutesAgo(2_000),
  }
}

export function seedFlows(): Flow[] {
  return [codFlow(), aiFlow(), cartFlow()]
}

export function seedTriggers(): Trigger[] {
  const stamp = { created_at: minutesAgo(50_000), updated_at: minutesAgo(50_000) }
  return [
    {
      ...stamp, id: 'trg-1', instance_name: DEMO_INSTANCE_ES, alias: 'Pedido novo → confirmação',
      tipo: 'contains', valor: '*', delay_ms: 60_000, action: 'flow', action_payload: { flow_id: FLOW_COD_ID }, source: 'shopify_order',
    },
    {
      ...stamp, id: 'trg-2', instance_name: DEMO_INSTANCE_ES, alias: 'Qualquer mensagem → IA',
      tipo: 'contains', valor: '*', delay_ms: 0, action: 'flow', action_payload: { flow_id: FLOW_AI_ID }, source: 'message',
    },
    {
      ...stamp, id: 'trg-3', instance_name: DEMO_INSTANCE_ES, alias: 'Horário',
      tipo: 'contains', valor: 'horario', delay_ms: 1500, action: 'send_message',
      action_payload: { message: 'Atendemos {{horario}}.' }, source: 'message',
    },
    {
      ...stamp, id: 'trg-4', instance_name: DEMO_INSTANCE_PT, alias: 'Carrinho abandonado → recuperação',
      tipo: 'contains', valor: '*', delay_ms: 1_800_000, action: 'flow', action_payload: { flow_id: FLOW_CART_ID }, source: 'shopify_abandoned_checkout',
    },
  ]
}

export function seedFlowMedia(): FlowMedia[] {
  const items: Array<[string, string, string, string]> = [
    ['media-1', DEMO_INSTANCE_ES, 'cojin-brisa.svg', demoImage('Cojín Brisa', '#00a884')],
    ['media-2', DEMO_INSTANCE_ES, 'masajeador-brisa.svg', demoImage('Masajeador Brisa', '#7c5cbf')],
    ['media-3', DEMO_INSTANCE_ES, 'almohada-brisa.svg', demoImage('Almohada Brisa', '#3b82a6')],
    ['media-4', DEMO_INSTANCE_PT, 'almofada-brisa.svg', demoImage('Almofada Brisa', '#00a884')],
    ['media-5', DEMO_INSTANCE_PT, 'massajador-brisa.svg', demoImage('Massajador Brisa', '#7c5cbf')],
  ]
  return items.map(([id, instance_name, filename, url]) => ({
    id, instance_name, filename, storage_path: `demo/${filename}`, url, size_bytes: 18_400, created_at: minutesAgo(25_000),
  }))
}

export interface DemoTemplate {
  id: string
  instance_name: string
  meta_template_name: string
  language: string
  category: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'
  body_text: string
  variable_count: number
  buttons: unknown
  status_reason: string | null
  status_updated_at: string | null
  last_synced_at: string | null
}

export function seedTemplates(): DemoTemplate[] {
  const base = { instance_name: DEMO_INSTANCE_PT, language: 'pt_PT', buttons: [], status_reason: null, status_updated_at: minutesAgo(9_000), last_synced_at: minutesAgo(120) }
  return [
    {
      ...base, id: TEMPLATE_CONFIRMACAO_ID, meta_template_name: 'confirmacao_encomenda', category: 'UTILITY', status: 'approved', variable_count: 3,
      body_text: 'Olá {{1}}, recebemos a sua encomenda {{2}} no valor de {{3}}, com pagamento na entrega. Confirma a morada de envio?',
    },
    {
      ...base, id: TEMPLATE_CARRINHO_ID, meta_template_name: 'carrinho_abandonado', category: 'MARKETING', status: 'approved', variable_count: 2,
      body_text: 'Olá {{1}}, deixou {{2}} no carrinho. Quer ajuda para concluir a encomenda? O pagamento é feito só na entrega.',
    },
    {
      ...base, id: 'tpl-avaliacao', meta_template_name: 'pedido_avaliacao', category: 'MARKETING', status: 'pending', variable_count: 1,
      body_text: 'Olá {{1}}, a sua encomenda já chegou? Adorávamos saber a sua opinião 💚',
    },
  ]
}

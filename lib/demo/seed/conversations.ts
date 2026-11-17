import type { AISession, AppNotification, Conversation, Message, MessageVariable } from '@/types'
import { minutesAgo } from '../clock'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from './accounts'
import { FLOW_AI_ID, FLOW_AI_NODE_ID, FLOW_COD_ID } from './ids'
import { demoImage } from './images'

type Line = [minutesAgo: number, direction: 'in' | 'out', content: string, sender?: Message['sender_type'], type?: string]

interface Draft {
  id: string
  instance: string
  name: string
  phone: string
  unread: number
  lines: Line[]
}

// Clientes, telefones e conversas inventados para a demonstração.
const DRAFTS: Draft[] = [
  {
    id: 'conv-es-1', instance: DEMO_INSTANCE_ES, name: 'Lucía Fernández', phone: '34900555101', unread: 2,
    lines: [
      [190, 'out', 'Hola Lucía 👋 Hemos recibido tu pedido #1042: 1x Cojín Ortopédico Brisa (39,90 €), pago contra reembolso.\n\n¿Confirmas la dirección: Calle Ficticia 12, 2ºB, Valencia?', 'flow'],
      [184, 'in', 'Sí, es correcta'],
      [183, 'out', '¡Perfecto! Tu pedido queda confirmado ✅ Te avisaremos cuando salga del almacén.', 'flow'],
      [12, 'in', 'Hola, una pregunta'],
      [11, 'in', '¿Puedo cambiar la entrega para el viernes por la tarde?'],
    ],
  },
  {
    id: 'conv-es-2', instance: DEMO_INSTANCE_ES, name: 'Javier Morales', phone: '34900555102', unread: 0,
    lines: [
      [95, 'out', 'Hola Javier, vimos que dejaste un Masajeador Cervical Brisa en el carrito 🛒 ¿Te ayudo a terminar el pedido? El pago es al recibir.', 'flow'],
      [90, 'in', '¿Cuánto tarda el envío?'],
      [89, 'out', 'Entre 24 y 48 horas laborables en península, y pagas al repartidor cuando lo recibes.', 'ai'],
      [86, 'in', 'Vale, ¿y si no me convence?'],
      [85, 'out', 'Tienes 14 días para devolverlo sin coste. ¿Quieres que te lo reserve?', 'ai'],
      [60, 'in', 'Sí, adelante'],
      [59, 'out', 'Hecho ✅ Pedido #1047 creado. ¡Gracias por confiar en nosotros!', 'ai'],
    ],
  },
  {
    id: 'conv-es-3', instance: DEMO_INSTANCE_ES, name: 'Carmen Ruiz', phone: '34900555103', unread: 1,
    lines: [
      [300, 'out', 'Hola Carmen, tu pedido #1039 ya está en reparto 🚚', 'flow'],
      [45, 'in', demoImage('Paquete recibido', '#3b82a6'), null, 'image'],
      [44, 'in', 'Ha llegado con la caja un poco abollada, pero el producto está bien 😊'],
    ],
  },
  {
    id: 'conv-es-4', instance: DEMO_INSTANCE_ES, name: 'Andrés Castillo', phone: '34900555104', unread: 0,
    lines: [
      [1500, 'out', 'Hola Andrés, intentamos entregar tu pedido #1031 pero no había nadie. ¿Qué día te viene mejor?', 'flow'],
      [1440, 'in', 'Mañana por la mañana, por favor'],
      [1438, 'out', 'Anotado. Se lo paso al repartidor ahora mismo.', 'human'],
      [1437, 'in', '¡Gracias!'],
    ],
  },
  {
    id: 'conv-es-5', instance: DEMO_INSTANCE_ES, name: 'Marta Soler', phone: '34900555105', unread: 0,
    lines: [
      [2900, 'out', 'Hola Marta 👋 Hemos recibido tu pedido #1028: 2x Almohada Viscoelástica Brisa (59,80 €). ¿Confirmas el envío?', 'flow'],
      [2880, 'out', 'Seguimos pendientes de tu confirmación para poder enviar el pedido 🙂', 'flow'],
    ],
  },
  {
    id: 'conv-pt-1', instance: DEMO_INSTANCE_PT, name: 'Beatriz Antunes', phone: '351900555201', unread: 1,
    lines: [
      [130, 'out', 'Olá Beatriz 👋 Recebemos a sua encomenda #2014: 1x Almofada Ortopédica Brisa (39,90 €), pagamento na entrega.\n\nConfirma a morada: Rua Inventada 8, 3.º Esq., Porto?', 'flow'],
      [124, 'in', 'Confirmo'],
      [123, 'out', 'Encomenda confirmada ✅ Avisamos assim que sair do armazém.', 'flow'],
      [20, 'in', 'Boa tarde, já têm previsão de entrega?'],
    ],
  },
  {
    id: 'conv-pt-2', instance: DEMO_INSTANCE_PT, name: 'Rui Tavares', phone: '351900555202', unread: 0,
    lines: [
      [400, 'in', 'Olá, o massajador funciona a pilhas ou tem bateria?'],
      [399, 'out', 'Olá Rui! Tem bateria recarregável por USB-C, com cerca de 2 horas de autonomia.', 'ai'],
      [396, 'in', 'Perfeito, quero encomendar um'],
      [395, 'out', 'Ótimo! Vou passar a um colega para fechar a encomenda consigo.', 'ai'],
      [380, 'out', 'Olá Rui, daqui é a Sofia. Já criei a encomenda #2019, paga apenas na entrega 🙂', 'human'],
    ],
  },
  {
    id: 'conv-pt-3', instance: DEMO_INSTANCE_PT, name: 'Helena Marques', phone: '351900555203', unread: 0,
    lines: [
      [4300, 'out', 'Olá Helena, a sua encomenda #2003 foi entregue hoje. Esperamos que goste! 💚', 'flow'],
      [4200, 'in', 'Chegou tudo bem, obrigada!'],
    ],
  },
]

export interface ChatSeed {
  conversations: Conversation[]
  messages: Message[]
}

export function seedChat(): ChatSeed {
  const conversations: Conversation[] = []
  const messages: Message[] = []
  for (const draft of DRAFTS) {
    draft.lines.forEach(([minutes, direction, content, sender, type], index) => {
      messages.push({
        id: `${draft.id}-m${index + 1}`,
        conversation_id: draft.id,
        wa_message_id: null,
        content,
        type: type ?? 'text',
        direction: direction === 'in' ? 'inbound' : 'outbound',
        status: 'read',
        sender_type: direction === 'in' ? null : sender ?? 'human',
        created_at: minutesAgo(minutes),
      })
    })
    const last = draft.lines[draft.lines.length - 1]
    conversations.push({
      id: draft.id,
      wa_id: `${draft.phone}@s.whatsapp.net`,
      instance_name: draft.instance,
      contact_name: draft.name,
      contact_phone: draft.phone,
      profile_pic_url: null,
      last_message: last[4] === 'image' ? '[imagem]' : last[2],
      last_message_at: minutesAgo(last[0]),
      unread_count: draft.unread,
      created_at: minutesAgo(draft.lines[0][0]),
      updated_at: minutesAgo(last[0]),
    })
  }
  return { conversations, messages }
}

export function seedAiSessions(): AISession[] {
  return [
    {
      id: 'ai-session-1',
      instance_name: DEMO_INSTANCE_ES,
      remote_jid: '34900555101@s.whatsapp.net',
      flow_id: FLOW_AI_ID,
      node_id: FLOW_AI_NODE_ID,
      message_count: 2,
      max_messages: null,
      expires_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      response_delay_ms: 5000,
      pending_message: null,
      pending_messages: [],
      history: [
        { role: 'user', content: 'Hola, una pregunta' },
        { role: 'user', content: '¿Puedo cambiar la entrega para el viernes por la tarde?' },
      ],
      last_message_at: minutesAgo(11),
      requires_human: true,
    },
  ]
}

export function seedNotifications(): AppNotification[] {
  const base = { flow_node_id: null, source_key: null, metadata: {}, dismissed_at: null }
  return [
    {
      ...base, id: 'notif-1', instance_name: DEMO_INSTANCE_ES, type: 'escalation',
      title: 'Lucía Fernández precisa de um humano',
      message: 'A cliente quer alterar a data de entrega do pedido #1042. A IA parou e aguarda um operador.',
      conversation_id: 'conv-es-1', flow_id: FLOW_AI_ID, read_at: null, created_at: minutesAgo(10),
    },
    {
      ...base, id: 'notif-2', instance_name: DEMO_INSTANCE_ES, type: 'flow',
      title: 'Pedido #1028 sem resposta',
      message: 'Marta Soler não respondeu à confirmação após 2 tentativas.',
      conversation_id: 'conv-es-5', flow_id: FLOW_COD_ID, read_at: null, created_at: minutesAgo(2870),
    },
    {
      ...base, id: 'notif-3', instance_name: DEMO_INSTANCE_PT, type: 'flow',
      title: 'Rui Tavares quer encomendar',
      message: 'A IA encaminhou o cliente para fechar a encomenda de um massajador.',
      conversation_id: 'conv-pt-2', flow_id: FLOW_AI_ID, read_at: minutesAgo(370), created_at: minutesAgo(395),
    },
  ]
}

export function seedMessageVariables(): MessageVariable[] {
  const rows: Array<[string, string, string, string]> = [
    [DEMO_INSTANCE_ES, 'horario', 'Horario de atención', 'De lunes a viernes, de 9:00 a 18:00'],
    [DEMO_INSTANCE_ES, 'plazo_envio', 'Plazo de envío', '24 a 48 horas laborables'],
    [DEMO_INSTANCE_PT, 'horario', 'Horário de atendimento', 'De segunda a sexta, das 9h às 18h'],
    [DEMO_INSTANCE_PT, 'prazo_envio', 'Prazo de envio', '24 a 48 horas úteis'],
  ]
  return rows.map(([instance_name, key, label, value], index) => ({
    id: `var-${index + 1}`, instance_name, key, label, value,
    created_at: minutesAgo(20_000), updated_at: minutesAgo(20_000),
  }))
}

import type { Flow, SandboxContact, Trigger } from '@/types'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from '@/lib/sandbox'
import { minutesAgo } from '../clock'
import { edge, node } from './flows'

export const SANDBOX_FLOW_ORDER_ID = 'sbx-flow-confirmacao'
export const SANDBOX_FLOW_MESSAGE_ID = 'sbx-flow-atendimento'
export const SANDBOX_FLOW_CART_ID = 'sbx-flow-carrinho'

const stamp = () => ({ created_at: minutesAgo(15_000), updated_at: minutesAgo(15_000) })

const flow = (id: string, name: string, json: Flow['json']): Flow =>
  ({ ...stamp(), id, instance_name: SANDBOX_INSTANCE_NAME, name, json, ativo: true, managed_by_automation_id: null })

// Fluxos da conta sandbox. São estes que o chat de teste executa — e continuam
// a ser executados depois de editados no construtor de fluxos.
export function seedSandboxFlows(): Flow[] {
  const order = flow(SANDBOX_FLOW_ORDER_ID, 'Sandbox · Confirmação de encomenda', {
    nodes: [
      node('start', 'start', 320, 0, { label: 'Encomenda nova' }),
      node('msg-confirma', 'sendMessage', 320, 130, {
        label: 'Pedir confirmação',
        message: 'Olá {{contato.primeiro_nome}} 👋 Recebemos a sua encomenda {{pedido.numero}}:\n{{pedido.produtos}}\n\nTotal: {{pedido.total}}, pago na entrega. Confirma o envio para {{pedido.endereco_completo}}?',
        replyButtons: [
          { id: 'btn-sim', label: 'Sim, confirmo' },
          { id: 'btn-morada', label: 'Alterar morada' },
        ],
      }),
      node('switch', 'switchCase', 320, 340, {
        label: 'Resposta do cliente',
        cases: [
          { id: 'case-sim', conditionType: 'contains', value: 'sim' },
          { id: 'case-morada', conditionType: 'contains', value: 'morada' },
        ],
      }),
      node('estado', 'captureOrderData', 40, 550, {
        label: 'Marcar como confirmado',
        orderStateField: 'commercial_status',
        orderStateValue: 'Confirmado WhatsApp',
      }),
      node('msg-ok', 'sendMessage', 40, 710, {
        label: 'Confirmado',
        message: 'Encomenda confirmada ✅ Avisamos assim que sair do armazém.',
      }),
      node('notify', 'notify', 320, 550, {
        label: 'Avisar operador',
        notificationMessage: '{{contato.primeiro_nome}} quer alterar a morada da encomenda {{pedido.numero}}.',
      }),
      node('msg-morada', 'sendMessage', 320, 710, {
        label: 'Pedir nova morada',
        message: 'Sem problema. Escreva a morada completa e um colega atualiza já a encomenda.',
      }),
      node('ia', 'aiAssistant', 600, 550, {
        label: 'IA tira dúvidas',
        systemPrompt: 'Responde em português de Portugal a dúvidas sobre a encomenda contra-reembolso. Se o cliente quiser cancelar, passa a um humano.',
        useDefaultModel: true, historyLimit: 20, temperature: 0.4, timeoutType: 'minutes', timeoutValue: 360, responseDelayMs: 3000,
      }),
      node('end', 'end', 320, 890, { label: 'Fim' }),
    ],
    edges: [
      edge('start', 'msg-confirma'),
      edge('msg-confirma', 'switch'),
      edge('switch', 'estado', 'case-0'),
      edge('switch', 'notify', 'case-1'),
      edge('switch', 'ia', 'default'),
      edge('estado', 'msg-ok'),
      edge('msg-ok', 'end'),
      edge('notify', 'msg-morada'),
      edge('msg-morada', 'end'),
      edge('ia', 'end'),
    ],
  })

  const message = flow(SANDBOX_FLOW_MESSAGE_ID, 'Sandbox · Atendimento', {
    nodes: [
      node('start', 'start', 300, 0, { label: 'Mensagem do cliente' }),
      node('cond', 'condition', 300, 130, { label: 'Pede um humano?', conditionType: 'contains', conditionValue: 'humano' }),
      node('notify', 'notify', 40, 320, { label: 'Avisar operador', notificationMessage: '{{contato.primeiro_nome}} pediu para falar com uma pessoa.' }),
      node('msg-humano', 'sendMessage', 40, 480, { label: 'Aviso ao cliente', message: 'Claro, vou passar a um colega. Em breve alguém lhe responde.' }),
      node('ia', 'aiAssistant', 560, 320, {
        label: 'Atendimento com IA',
        systemPrompt: 'És a assistente da Casa Brisa. Responde em português de Portugal sobre produtos, prazos de envio e pagamento na entrega.',
        useDefaultModel: true, historyLimit: 20, temperature: 0.5, continueConversation: true, timeoutType: 'minutes', timeoutValue: 360, responseDelayMs: 3000,
      }),
      node('end', 'end', 300, 660, { label: 'Fim' }),
    ],
    edges: [
      edge('start', 'cond'),
      edge('cond', 'notify', 'true'),
      edge('cond', 'ia', 'false'),
      edge('notify', 'msg-humano'),
      edge('msg-humano', 'end'),
      edge('ia', 'end'),
    ],
  })

  const cart = flow(SANDBOX_FLOW_CART_ID, 'Sandbox · Carrinho abandonado', {
    nodes: [
      node('start', 'start', 300, 0, { label: 'Carrinho abandonado' }),
      node('msg', 'sendMessage', 300, 130, {
        label: 'Lembrete do carrinho',
        message: 'Olá {{contato.primeiro_nome}}, reparámos que deixou isto no carrinho 🛒\n{{carrinho.produtos}}\n\nQuer ajuda para concluir? O pagamento é feito só na entrega.',
        replyButtons: [
          { id: 'btn-quero', label: 'Quero concluir' },
          { id: 'btn-nao', label: 'Agora não' },
        ],
      }),
      node('switch', 'switchCase', 300, 340, {
        label: 'Resposta do cliente',
        cases: [
          { id: 'case-quero', conditionType: 'contains', value: 'quero' },
          { id: 'case-nao', conditionType: 'contains', value: 'não' },
        ],
      }),
      node('msg-link', 'sendMessage', 20, 550, { label: 'Enviar link', message: 'Perfeito! Pode concluir aqui: {{carrinho.link}}' }),
      node('msg-nao', 'sendMessage', 300, 550, { label: 'Despedida', message: 'Sem problema! Se mudar de ideias, é só responder a esta mensagem 🙂' }),
      node('ia', 'aiAssistant', 580, 550, {
        label: 'IA tira dúvidas',
        systemPrompt: 'Responde em português de Portugal a dúvidas sobre o produto do carrinho, sem pressionar.',
        useDefaultModel: true, historyLimit: 20, temperature: 0.5, timeoutType: 'messages', timeoutValue: 12, responseDelayMs: 3000,
      }),
      node('end', 'end', 300, 740, { label: 'Fim' }),
    ],
    edges: [
      edge('start', 'msg'),
      edge('msg', 'switch'),
      edge('switch', 'msg-link', 'case-0'),
      edge('switch', 'msg-nao', 'case-1'),
      edge('switch', 'ia', 'default'),
      edge('msg-link', 'end'),
      edge('msg-nao', 'end'),
      edge('ia', 'end'),
    ],
  })

  return [order, message, cart]
}

export function seedSandboxTriggers(): Trigger[] {
  const trigger = (id: string, alias: string, source: Trigger['source'], flowId: string): Trigger => ({
    ...stamp(), id, instance_name: SANDBOX_INSTANCE_NAME, alias, tipo: 'contains', valor: '*', delay_ms: 0,
    action: 'flow', action_payload: { flow_id: flowId }, source,
  })
  return [
    trigger('sbx-trg-shopify', 'Pedido Shopify → confirmação', 'shopify_order', SANDBOX_FLOW_ORDER_ID),
    trigger('sbx-trg-lightfunnels', 'Pedido Lightfunnels → confirmação', 'lightfunnels_order', SANDBOX_FLOW_ORDER_ID),
    trigger('sbx-trg-mensagem', 'Qualquer mensagem → atendimento', 'message', SANDBOX_FLOW_MESSAGE_ID),
    trigger('sbx-trg-carrinho', 'Carrinho abandonado → recuperação', 'shopify_abandoned_checkout', SANDBOX_FLOW_CART_ID),
  ]
}

export function seedSandboxContacts(): SandboxContact[] {
  return [{
    id: 'sbx-contact-1',
    wa_id: SANDBOX_REMOTE_JID,
    contact_name: 'Cliente de teste',
    contact_phone: '351900000000',
    sandbox_source_instance: null,
    sandbox_real_send_enabled: false,
  }]
}

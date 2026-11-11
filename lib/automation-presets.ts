// Modelos prontos das automações simples — um por gatilho do sistema
// (carrinho abandonado, pedido criado, status de entrega, palavra-chave).
// Um modelo novo entra como uma nova entrada aqui, mais o ponto de disparo
// correspondente no servidor (lib/automation-runtime.ts).

import type { AutomationConfig, AutomationKind, AutomationStepInput, CatalogPlatform } from '@/types'

export interface AutomationPreset {
  kind: AutomationKind
  label: string
  description: string
  // Plataformas em que o modelo já tem disparo implementado. Vazio = o
  // modelo não depende de pedido/loja (palavra-chave).
  platforms: CatalogPlatform[]
  // Casa por país + linha de produto (eventos de carrinho/pedido).
  usesOrderScope: boolean
  maxSteps: number
  // Rótulo do tempo de espera de cada etapa na UI; null = envia na hora.
  delayLabel: string | null
  // Número oficial: a primeira mensagem é da empresa → exige template.
  requiresTemplateOnCloudApi: boolean
  defaultSteps: AutomationStepInput[]
  defaultConfig: AutomationConfig
  // Grupos de variáveis (message-template.ts) oferecidos no editor.
  variableGroups: string[]
}

const immediateStep = (message: string): AutomationStepInput => ({
  delay_minutes: 0,
  message,
  fallback_template_id: null,
  fallback_template_variable_map: {},
})

export const AUTOMATION_PRESETS: Record<AutomationKind, AutomationPreset> = {
  abandoned_cart: {
    kind: 'abandoned_cart',
    label: 'Carrinho abandonado',
    description:
      'Envia um lembrete quando o cliente deixa o checkout (ou o rascunho do formulário COD) sem concluir. ' +
      'O tempo conta da última atividade do cliente; se ele comprar antes, nada é enviado.',
    platforms: ['shopify'],
    usesOrderScope: true,
    maxSteps: 3,
    delayLabel: 'Enviar após (minutos sem atividade)',
    requiresTemplateOnCloudApi: true,
    defaultSteps: [
      {
        delay_minutes: 60,
        message:
          'Olá {{contato.primeiro_nome}}! Vimos que você não concluiu seu pedido.\n' +
          '{{carrinho.produtos}}\n\nSeu carrinho ainda está disponível: {{carrinho.link}}',
        fallback_template_id: null,
        fallback_template_variable_map: {},
      },
      {
        delay_minutes: 24 * 60,
        message:
          '{{contato.primeiro_nome}}, seu carrinho de {{carrinho.total}} ainda está reservado.\n' +
          'Finalize aqui: {{carrinho.link}}\nSe tiver alguma dúvida, é só responder esta mensagem.',
        fallback_template_id: null,
        fallback_template_variable_map: {},
      },
    ],
    defaultConfig: {},
    variableGroups: ['Contato', 'Carrinho'],
  },
  order_created: {
    kind: 'order_created',
    label: 'Pedido criado',
    description:
      'Envia uma mensagem assim que chega um pedido novo da loja ou do funil — no lugar do gatilho ' +
      '"Pedido criado" da conta para os pedidos deste país e linha.',
    platforms: ['shopify', 'lightfunnels'],
    usesOrderScope: true,
    maxSteps: 1,
    delayLabel: null,
    requiresTemplateOnCloudApi: true,
    defaultSteps: [immediateStep(
      'Olá {{contato.primeiro_nome}}! Recebemos seu pedido {{pedido.numero}}:\n{{pedido.produtos}}\n\n' +
      'Total: {{pedido.total}}, pago na entrega.\nEndereço: {{pedido.endereco_completo}}\n\n' +
      'Se algo estiver errado, é só responder esta mensagem.'
    )],
    defaultConfig: {},
    variableGroups: ['Contato', 'Pedido'],
  },
  delivery_status: {
    kind: 'delivery_status',
    label: 'Status de entrega',
    description:
      'Avisa o cliente quando a entrega do pedido muda para um dos estados escolhidos (ex: a caminho, ' +
      'entregue) — no lugar do gatilho "Status de entrega" da conta.',
    platforms: ['shopify', 'lightfunnels'],
    usesOrderScope: true,
    maxSteps: 1,
    delayLabel: null,
    requiresTemplateOnCloudApi: true,
    defaultSteps: [immediateStep(
      'Olá {{contato.primeiro_nome}}! Atualização do seu pedido {{pedido.numero}}: {{pedido.status_entrega}}.'
    )],
    defaultConfig: { statuses: ['A caminho'] },
    variableGroups: ['Contato', 'Pedido'],
  },
  message_keyword: {
    kind: 'message_keyword',
    label: 'Resposta por palavra-chave',
    description:
      'Responde automaticamente quando o cliente manda uma mensagem com as palavras escolhidas — antes ' +
      'dos gatilhos de mensagem do número.',
    platforms: [],
    usesOrderScope: false,
    maxSteps: 1,
    delayLabel: null,
    requiresTemplateOnCloudApi: false,
    defaultSteps: [immediateStep('Olá {{contato.primeiro_nome}}! Recebemos sua mensagem e já vamos te responder.')],
    defaultConfig: { keywords: '', match: 'contains' },
    variableGroups: ['Contato'],
  },
}

export const AUTOMATION_KIND_ORDER: AutomationKind[] = ['abandoned_cart', 'order_created', 'delivery_status', 'message_keyword']

export function isAutomationKind(value: unknown): value is AutomationKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUTOMATION_PRESETS, value)
}

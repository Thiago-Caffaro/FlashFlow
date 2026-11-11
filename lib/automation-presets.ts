// Modelos prontos das automações simples. Um modelo novo (confirmação de
// pedido, atualização de entrega…) entra como uma nova entrada aqui, mais o
// ponto de disparo correspondente no servidor.

import type { AutomationKind, AutomationStepInput, CatalogPlatform } from '@/types'

export interface AutomationPreset {
  kind: AutomationKind
  label: string
  description: string
  // Plataformas em que o modelo já tem disparo implementado.
  platforms: CatalogPlatform[]
  maxSteps: number
  // Rótulo do tempo de espera de cada etapa na UI.
  delayLabel: string
  defaultSteps: AutomationStepInput[]
  // Grupos de variáveis (message-template.ts) oferecidos no editor.
  variableGroups: string[]
}

export const AUTOMATION_PRESETS: Record<AutomationKind, AutomationPreset> = {
  abandoned_cart: {
    kind: 'abandoned_cart',
    label: 'Carrinho abandonado',
    description:
      'Envia um lembrete quando o cliente deixa o checkout (ou o rascunho do formulário COD) sem concluir. ' +
      'O tempo conta da última atividade do cliente; se ele comprar antes, nada é enviado.',
    platforms: ['shopify'],
    maxSteps: 3,
    delayLabel: 'Enviar após (minutos sem atividade)',
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
    variableGroups: ['Contato', 'Carrinho'],
  },
}

export function isAutomationKind(value: unknown): value is AutomationKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUTOMATION_PRESETS, value)
}

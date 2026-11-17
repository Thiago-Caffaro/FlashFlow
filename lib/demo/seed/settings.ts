import type { AgentMemoryBlock, SlackChannel, SlackConnectionStatus, SlackNotificationSettings } from '@/types'
import { minutesAgo } from '../clock'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from './accounts'

export function seedMemoryBlocks(): AgentMemoryBlock[] {
  const block = (id: string, instance_name: string, name: string, type: AgentMemoryBlock['type'], keywords: string[], content: string): AgentMemoryBlock =>
    ({ id, instance_name, name, type, keywords, content, created_at: minutesAgo(35_000), updated_at: minutesAgo(3_000) })
  return [
    block('mem-loja', DEMO_INSTANCE_ES, 'Sobre la tienda', 'always', [],
      'Casa Brisa vende productos de descanso y bienestar. Envío en 24–48 h laborables. Pago únicamente contra reembolso (efectivo o tarjeta al repartidor).'),
    block('mem-envios', DEMO_INSTANCE_ES, 'Envíos', 'contextual', ['envío', 'entrega', 'llega', 'tarda'],
      'Entregamos en península en 24–48 h laborables. Baleares 3–5 días. No enviamos a Canarias. El repartidor llama antes de entregar.'),
    block('mem-devolucoes', DEMO_INSTANCE_ES, 'Devoluciones', 'contextual', ['devolver', 'devolución', 'cambio'],
      'El cliente tiene 14 días para devolver sin coste. La recogida la organiza la tienda; el reembolso se hace por transferencia en 5 días.'),
    block('mem-loja-pt', DEMO_INSTANCE_PT, 'Sobre a loja', 'always', [],
      'A Casa Brisa vende produtos de descanso e bem-estar. Envio em 24–48 h úteis. Pagamento apenas na entrega (dinheiro ou multibanco ao estafeta).'),
    block('mem-envios-pt', DEMO_INSTANCE_PT, 'Envios', 'contextual', ['envio', 'entrega', 'chega', 'demora'],
      'Entregamos em Portugal continental em 24–48 h úteis. Ilhas: 4–6 dias. O estafeta liga antes de entregar.'),
  ]
}

export interface DemoAiConfig {
  history_limit: number
  timeout_minutes_enabled: boolean
  timeout_minutes: number
  timeout_messages_enabled: boolean
  timeout_messages: number
  response_delay_ms: number
  inactivity_message: string
  escalation_enabled: boolean
  escalation_stop_on_obstacle: boolean
  escalation_base_prompt: string
}

// Mesmos valores por omissão de app/api/instance-ai-config/route.ts.
export const DEFAULT_AI_CONFIG: DemoAiConfig = {
  history_limit: 20,
  timeout_minutes_enabled: true,
  timeout_minutes: 360,
  timeout_messages_enabled: false,
  timeout_messages: 50,
  response_delay_ms: 5000,
  inactivity_message: '',
  escalation_enabled: true,
  escalation_stop_on_obstacle: true,
  escalation_base_prompt: '',
}

// Só o estado "configurada": nenhuma chave existe na demo.
export function seedAiKeys(): Record<string, { custom_model?: string; tools_supported?: boolean | null; updated_at: string }> {
  return {
    gemini: { custom_model: 'gemini-2.5-flash', tools_supported: true, updated_at: minutesAgo(12_000) },
    openrouter: { custom_model: 'anthropic/claude-sonnet-4.5', tools_supported: true, updated_at: minutesAgo(4_000) },
  }
}

export function seedSlackStatus(): SlackConnectionStatus {
  return { connected: true, teamName: 'Casa Brisa', botName: 'FlashFlow', hasSigningSecret: true, interactivityUrl: null, error: null }
}

export function seedSlackChannels(): SlackChannel[] {
  return [
    { id: 'C-ATEND', name: 'atendimento', is_private: false, is_member: true },
    { id: 'C-PEDIDOS', name: 'pedidos-cod', is_private: false, is_member: true },
    { id: 'C-ESCAL', name: 'escalamentos', is_private: true, is_member: true },
  ]
}

export function seedSlackSettings(): SlackNotificationSettings[] {
  return [
    { instance_name: DEMO_INSTANCE_ES, channel_id: 'C-ATEND', channel_name: 'atendimento', mention: 'here', forward_ai_escalation: true, forward_flow_notify: true, forward_outside_window: false },
    { instance_name: DEMO_INSTANCE_PT, channel_id: 'C-ESCAL', channel_name: 'escalamentos', mention: 'none', forward_ai_escalation: true, forward_flow_notify: false, forward_outside_window: true },
  ]
}

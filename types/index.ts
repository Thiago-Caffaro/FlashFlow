export interface Conversation {
  id: string
  wa_id: string
  instance_name: string
  contact_name: string | null
  contact_phone: string
  profile_pic_url: string | null
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  created_at: string
  updated_at: string
}

export type WhatsAppProvider = 'evolution' | 'cloud_api'

export interface Account {
  instanceName: string
  label: string
  state: 'open' | 'connecting' | 'close'
  profileName?: string | null
  profilePicUrl?: string | null
  phone?: string | null
  country?: string | null
  confirmationEnabled?: boolean
  confirmationPriority?: number
  isSandbox?: boolean
  provider?: WhatsAppProvider
}

export interface Message {
  id: string
  conversation_id: string
  wa_message_id: string | null
  content: string
  type: string
  direction: 'inbound' | 'outbound'
  status: string
  sender_type: 'human' | 'ai' | 'flow' | null
  created_at: string
  sender_jid?: string | null
  sender_name?: string | null
}

export type TriggerTipo = 'contains' | 'exact'
export type TriggerAction = 'send_message' | 'flow'
export type TriggerSource = 'message' | 'shopify_order' | 'delivery_status' | 'shopify_abandoned_checkout' | 'lightfunnels_order'

export interface Trigger {
  id: string
  instance_name: string
  alias: string
  tipo: TriggerTipo
  valor: string
  delay_ms: number
  action: TriggerAction
  action_payload: { message?: string; flow_id?: string; statuses?: DeliveryStatus[] }
  source: TriggerSource
  created_at: string
  updated_at: string
}

export type TriggerCreate = Omit<Trigger, 'id' | 'created_at' | 'updated_at'>

// ─── Flows ────────────────────────────────────────────────────────────────────

export type FlowNodeType =
  | 'start'
  | 'sendMessage'
  | 'notify'
  | 'slackNotify'
  | 'condition'
  | 'switchCase'
  | 'aiAssistant'
  | 'captureOrderData'
  // Kept only so existing saved flows continue to load and execute.
  | 'fulfillmentStock'
  | 'fulfillmentStatus'
  | 'end'

export type OrderStateField = 'commercial_status' | 'send_status' | 'delivery_status'

export interface SwitchCase {
  id: string
  conditionType: 'contains' | 'exact'
  value: string
}

export interface FlowImage {
  id: string
  url: string
  filename: string
}

export interface FlowReplyButton {
  id: string
  label: string
}

export interface FlowMedia {
  id: string
  instance_name: string
  filename: string
  storage_path: string
  url: string
  size_bytes: number
  created_at: string
}

export type AIProvider = 'gemini' | 'openai' | 'openrouter'

export type MemoryBlockType = 'always' | 'contextual'

export interface AgentMemoryBlock {
  id: string
  instance_name: string
  name: string
  content: string
  type: MemoryBlockType
  keywords: string[]
  created_at: string
  updated_at: string
}

export interface FlowNodeData {
  label?: string
  message?: string
  messageTitle?: string
  footer?: string
  replyButtons?: FlowReplyButton[]
  images?: FlowImage[]
  combineImageAndMessage?: boolean
  // notification
  notificationMessage?: string
  // slackNotify — canal vazio usa o canal padrão da conta (aba Integrações)
  slackChannelId?: string
  slackChannelName?: string
  slackTitle?: string
  slackMessage?: string
  slackMention?: SlackMention
  // true: encerra o fluxo e para a IA da conversa (transferência para humano)
  slackHandoff?: boolean
  // condition
  conditionType?: 'contains' | 'exact'
  conditionValue?: string
  // switchCase
  cases?: SwitchCase[]
  // aiAssistant
  systemPrompt?: string
  historyLimit?: number
  temperature?: number
  model?: string
  provider?: AIProvider
  customModel?: string
  useDefaultModel?: boolean
  continueConversation?: boolean
  timeoutType?: 'minutes' | 'messages'
  timeoutValue?: number
  responseDelayMs?: number
  memoryBlockIds?: string[]
  maxTokens?: number
  inactivityMessage?: string
  // start node
  sessionEndMessage?: { enabled: boolean; text: string }
  // fulfillment
  productId?: string
  successMessage?: string
  failureMessage?: string
  // order state capture
  orderStateField?: OrderStateField
  orderStateValue?: string
  // sendMessage em modo Template (WhatsApp Cloud API) — quando setado,
  // substitui o envio de texto livre pelo template aprovado correspondente
  templateId?: string
  templateVariableMap?: Record<string, string>
  // Template de fallback (WhatsApp Cloud API): o texto/botões do node seguem
  // sendo o envio normal; o template só entra no lugar quando a conta é
  // oficial e a janela de 24h está fechada.
  fallbackTemplateId?: string
  fallbackTemplateVariableMap?: Record<string, string>
  [key: string]: unknown
}

export interface FulfillmentProduct {
  id: string
  country: string
  sku: string
  name: string
  units_per_pack?: number
  price: number
  currency: string
  active: boolean
  created_at: string
  updated_at: string
}

export const COMMERCIAL_STATUSES = [
  'Confirmado WhatsApp',
  'Confirmado Call',
  'Confirmado Upsell Call',
  'Confirmado Upsell WhatsApp',
  'Confirmado',
  'Desistiu',
  'Não responde',
] as const

export type CommercialStatus = typeof COMMERCIAL_STATUSES[number]

export const SEND_STATUSES = ['Pendente', 'Enviado', 'Não enviar'] as const
export type SendStatus = typeof SEND_STATUSES[number]

export const DELIVERY_STATUSES = [
  'Não enviado',
  'Enviado',
  'A caminho',
  'Novidade',
  'Rejeitado',
  'Entregue',
] as const

export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

export type ConfirmationTriggerState = 'pending' | 'sent' | 'failed'

export const ABANDONED_CHECKOUT_STATUSES = ['Pendente', 'Enviado', 'Não enviar', 'Convertido'] as const
export type AbandonedCheckoutStatus = typeof ABANDONED_CHECKOUT_STATUSES[number]

export type OrderSource = 'manual' | 'shopify' | 'lightfunnels'

export interface FulfillmentOrder {
  id: string
  order_number: string
  lead_number: string | null
  instance_name: string
  country: string
  conversation_id: string | null
  contact_phone: string
  customer_name: string
  email: string | null
  address: string
  city: string
  province: string
  zipcode: string
  payment_type: 'COD' | 'PREPAID'
  items: Array<{
    product_id: string
    shopify_product_id?: string
    shopify_variant_id?: string
    shopify_quantity?: number
    lightfunnels_product_id?: string
    lightfunnels_variant_id?: string
    // Quantidade vendida na plataforma (pacotes), antes de multiplicar por
    // units_per_pack. Shopify continua usando shopify_quantity.
    lightfunnels_quantity?: number
    units_per_pack?: number
    pack_quantity_source?: 'sku' | 'catalog' | 'title' | 'default'
    sku: string
    name: string
    quantity: number
    unit_price: number
    total: number
  }>
  total: number
  currency: string
  status: string
  external_snapshot: Record<string, unknown> | null
  last_error: string | null
  submitted_at: string | null
  source: OrderSource
  shopify_integration_id: string | null
  shopify_order_id: string | null
  shopify_order_name: string | null
  shopify_order_number: string | null
  shopify_deleted_at?: string | null
  shopify_financial_status?: string | null
  shopify_fulfillment_status?: string | null
  shopify_cancelled_at?: string | null
  shopify_cancel_reason?: string | null
  shopify_closed_at?: string | null
  raw_shopify_payload: Record<string, unknown> | null
  // Lightfunnels (migration 027)
  lightfunnels_integration_id?: string | null
  lightfunnels_order_id?: string | null
  lightfunnels_order_name?: string | null
  lightfunnels_funnel_id?: string | null
  lightfunnels_store_id?: string | null
  lightfunnels_financial_status?: string | null
  lightfunnels_fulfillment_status?: string | null
  lightfunnels_cancelled_at?: string | null
  lightfunnels_archived_at?: string | null
  raw_lightfunnels_payload?: Record<string, unknown> | null
  lightfunnels_writeback_tags?: string[] | null
  lightfunnels_writeback_error?: string | null
  commercial_status: CommercialStatus
  send_status: SendStatus
  delivery_status: DeliveryStatus
  external_delivery_status?: string | null
  external_delivery_status_key?: string | null
  delivery_status_source?: 'local' | 'manual' | 'flow' | 'fenixcod'
  delivery_status_synced_at?: string | null
  delivery_status_changed_at?: string | null
  delivery_status_sync_error?: string | null
  confirmed_at: string | null
  confirmation_status_updated_at: string | null
  assigned_instance_name: string | null
  confirmation_message_sent_at: string | null
  confirmation_message_error: string | null
  is_simulation: boolean
  simulation_marker: string | null
  order_placed_at: string
  created_at: string
  updated_at: string
}

export interface ShopifyIntegration {
  id: string
  shop_name: string
  shop_domain: string
  default_country: string
  active: boolean
  oauth_connected: boolean
  confirmation_message_template: string | null
  recovery_message_template: string | null
  recovery_template_id: string | null
  recovery_template_variable_map: Record<string, string> | null
  // Client ID do app próprio da loja (migration 026); null = app global.
  app_client_id: string | null
  created_at: string
  updated_at: string
}

// Conta WhatsApp vinculada a uma loja Shopify (shopify_integration_accounts).
export interface ShopifyStoreAccountLink {
  instance_name: string
  priority: number
  enabled: boolean
}

export interface LightfunnelsIntegration {
  id: string
  name: string
  lf_account_id: string
  scopes: string
  default_country: string
  active: boolean
  oauth_connected: boolean
  writeback_enabled: boolean
  access_token_expires_at: string
  last_webhook_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

// Conta WhatsApp vinculada a uma conta Lightfunnels
// (lightfunnels_integration_accounts). funnel_ids vazio = todos os funis.
export interface LightfunnelsStoreAccountLink {
  instance_name: string
  priority: number
  enabled: boolean
  funnel_ids: string[]
}

export interface LightfunnelsFunnel {
  id: string
  name: string
  published: boolean
}

export interface LightfunnelsProduct {
  id: string
  lightfunnels_integration_id: string | null
  lf_product_id: string | null
  lf_variant_id: string | null
  sku: string | null
  title: string
  variant_title: string | null
  units_per_pack: number
  price: number
  currency: string
  image_url: string | null
  hidden: boolean
  keep_local_copy: boolean
  local_product_id: string | null
  created_at: string
  updated_at: string
}

export interface ShopifyProduct {
  id: string
  shopify_integration_id: string | null
  shopify_product_id: string | null
  shopify_variant_id: string | null
  sku: string | null
  title: string
  variant_title: string | null
  units_per_pack?: number
  price: number
  currency: string
  image_url: string | null
  source: 'shopify' | 'manual'
  hidden: boolean
  keep_local_copy: boolean
  local_product_id: string | null
  created_at: string
  updated_at: string
}

export interface MessageVariable {
  id: string
  instance_name: string
  key: string
  label: string
  value: string
  created_at: string
  updated_at: string
}

export type NotificationType = 'flow' | 'escalation'

// ─── Slack ────────────────────────────────────────────────────────────────────

export type SlackMention = 'none' | 'here' | 'channel'
export type SlackMessageSource = 'flow_node' | 'ai_escalation' | 'flow_notify' | 'outside_window' | 'test'

export interface SlackNotificationSettings {
  instance_name: string
  channel_id: string | null
  channel_name: string | null
  mention: SlackMention
  forward_ai_escalation: boolean
  forward_flow_notify: boolean
  forward_outside_window: boolean
}

export interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_member: boolean
}

export interface SlackConnectionStatus {
  connected: boolean
  teamName: string | null
  botName: string | null
  hasSigningSecret: boolean
  interactivityUrl: string | null
  error: string | null
}

export interface AppNotification {
  id: string
  instance_name: string
  type: NotificationType
  title: string
  message: string
  conversation_id: string | null
  flow_id: string | null
  flow_node_id: string | null
  source_key: string | null
  metadata: Record<string, unknown>
  read_at: string | null
  dismissed_at: string | null
  created_at: string
  // Preenchido pela API quando a notificação foi (ou tentou ser) enviada ao Slack
  slack?: AppNotificationSlackState | null
}

export interface AppNotificationSlackState {
  posted: boolean
  claimedByName: string | null
  claimedAt: string | null
  error: string | null
}

export interface ShopifyAbandonedCheckout {
  id: string
  shopify_integration_id: string | null
  shopify_checkout_id: string | null
  checkout_token: string | null
  shop_domain: string
  assigned_instance_name: string | null
  country: string
  contact_phone: string | null
  customer_name: string | null
  email: string | null
  abandoned_checkout_url: string | null
  total: number
  currency: string
  recovery_status: AbandonedCheckoutStatus
  raw_shopify_payload: Record<string, unknown> | null
  whatsapp_sent_at: string | null
  recovered_at: string | null
  shopify_completed_at: string | null
  last_error: string | null
  is_simulation: boolean
  simulation_marker: string | null
  created_at: string
  updated_at: string
}

export interface ExternalFulfillmentLead {
  source: 'fenixcod'
  lead_number: string
  order_number: string | null
  country: string
  customer_name: string | null
  contact_phone: string | null
  city: string | null
  total: number | null
  currency: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  raw?: Record<string, unknown>
}

export interface FlowNode {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: FlowNodeData
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
}

export interface Flow {
  id: string
  instance_name: string
  name: string
  json: { nodes: FlowNode[]; edges: FlowEdge[] }
  ativo: boolean
  created_at: string
  updated_at: string
}

export type FlowCreate = Omit<Flow, 'id' | 'created_at' | 'updated_at'>

// ─── AI Sessions ──────────────────────────────────────────────────────────────

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

export interface AISession {
  id: string
  instance_name: string
  remote_jid: string
  flow_id: string
  node_id: string
  message_count: number
  max_messages: number | null
  expires_at: string | null
  response_delay_ms: number
  pending_message: string | null
  pending_messages: string[]
  history: HistoryTurn[]
  last_message_at: string | null
  requires_human?: boolean
}

export interface AISessionWithContext {
  session: AISession
  conversation: Conversation
  flow_name: string | null
}

// ─── Conversation Analysis ─────────────────────────────────────────────────────

export interface MemorySuggestion {
  name: string
  content: string
  type: MemoryBlockType
  keywords: string[]
}

export interface AnalysisResult {
  analysis: string
  suggestions: MemorySuggestion[]
}

// ─── Sandbox ──────────────────────────────────────────────────────────────────

// Contato de teste da conta __sandbox__ (linha de `conversations`).
export interface SandboxContact {
  id: string
  wa_id: string
  contact_name: string | null
  contact_phone: string | null
  sandbox_source_instance: string | null
  sandbox_real_send_enabled: boolean
}

// Contato real encontrado na busca para importar como contato de teste.
export interface SandboxRealContactResult {
  id: string
  wa_id: string
  instance_name: string
  contact_name: string | null
  contact_phone: string | null
  accountLabel: string
}

// Pedido externo para uma aba abrir um item específico (ex: as mini janelas
// do Sandbox). `nonce` muda a cada clique, então clicar de novo no mesmo item
// reabre mesmo depois de fechado.
export interface ItemFocusRequest {
  id: string
  nonce: number
}

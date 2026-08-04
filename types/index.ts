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
export type TriggerSource = 'message' | 'shopify_order'

export interface Trigger {
  id: string
  instance_name: string
  alias: string
  tipo: TriggerTipo
  valor: string
  delay_ms: number
  action: TriggerAction
  action_payload: { message?: string; flow_id?: string }
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
  [key: string]: unknown
}

export interface FulfillmentProduct {
  id: string
  country: string
  sku: string
  name: string
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

export const ABANDONED_CHECKOUT_STATUSES = ['Pendente', 'Enviado', 'Não enviar', 'Convertido'] as const
export type AbandonedCheckoutStatus = typeof ABANDONED_CHECKOUT_STATUSES[number]

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
  source: 'manual' | 'shopify'
  shopify_integration_id: string | null
  shopify_order_id: string | null
  shopify_order_name: string | null
  shopify_order_number: string | null
  raw_shopify_payload: Record<string, unknown> | null
  commercial_status: CommercialStatus
  send_status: SendStatus
  delivery_status: DeliveryStatus
  confirmed_at: string | null
  confirmation_status_updated_at: string | null
  assigned_instance_name: string | null
  confirmation_message_sent_at: string | null
  confirmation_message_error: string | null
  is_simulation: boolean
  simulation_marker: string | null
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
  created_at: string
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

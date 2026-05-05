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

export interface Trigger {
  id: string
  instance_name: string
  alias: string
  tipo: TriggerTipo
  valor: string
  delay_ms: number
  action: TriggerAction
  action_payload: { message?: string; flow_id?: string }
  created_at: string
  updated_at: string
}

export type TriggerCreate = Omit<Trigger, 'id' | 'created_at' | 'updated_at'>

// ─── Flows ────────────────────────────────────────────────────────────────────

export type FlowNodeType = 'start' | 'sendMessage' | 'condition' | 'switchCase' | 'aiAssistant' | 'end'

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
  images?: FlowImage[]
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
  [key: string]: unknown
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

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
  created_at: string
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

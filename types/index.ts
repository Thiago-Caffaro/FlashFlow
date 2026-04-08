export interface Conversation {
  id: string
  wa_id: string
  contact_name: string | null
  contact_phone: string
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  created_at: string
  updated_at: string
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

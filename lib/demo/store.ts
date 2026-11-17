import type { AISession, Account, AppNotification, Conversation, Flow, Message, MessageVariable } from '@/types'
import { seedAccounts } from './seed/accounts'
import { seedAiSessions, seedChat, seedMessageVariables, seedNotifications } from './seed/conversations'

// Estado em memória da demo. Nada é persistido: recarregar a página repõe
// os dados de exemplo.
export interface DemoStore {
  /** Contador para ids gerados durante a sessão. */
  seq: number
  accounts: Account[]
  conversations: Conversation[]
  messages: Message[]
  aiSessions: AISession[]
  notifications: AppNotification[]
  messageVariables: MessageVariable[]
  flows: Flow[]
}

function createStore(): DemoStore {
  const chat = seedChat()
  return {
    seq: 1000,
    accounts: seedAccounts(),
    conversations: chat.conversations,
    messages: chat.messages,
    aiSessions: seedAiSessions(),
    notifications: seedNotifications(),
    messageVariables: seedMessageVariables(),
    flows: [],
  }
}

let store: DemoStore | null = null

export function getStore(): DemoStore {
  if (!store) store = createStore()
  return store
}

export function resetStore(): void {
  store = null
}

export function nextId(target: DemoStore, prefix: string): string {
  target.seq += 1
  return `${prefix}-${target.seq}`
}

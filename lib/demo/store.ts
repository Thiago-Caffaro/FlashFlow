import type {
  AISession,
  Account,
  AppNotification,
  AutomationWithSteps,
  CatalogProductOption,
  Conversation,
  Flow,
  FlowMedia,
  Message,
  MessageVariable,
  ProductLineWithProducts,
  Trigger,
} from '@/types'
import { seedAccounts } from './seed/accounts'
import { seedAutomations, seedCatalog, seedProductLines } from './seed/automations'
import { seedAiSessions, seedChat, seedMessageVariables, seedNotifications } from './seed/conversations'
import { seedFlowMedia, seedFlows, seedTemplates, seedTriggers, type DemoTemplate } from './seed/flows'

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
  triggers: Trigger[]
  flowMedia: FlowMedia[]
  templates: DemoTemplate[]
  automations: AutomationWithSteps[]
  productLines: ProductLineWithProducts[]
  catalog: CatalogProductOption[]
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
    flows: seedFlows(),
    triggers: seedTriggers(),
    flowMedia: seedFlowMedia(),
    templates: seedTemplates(),
    automations: seedAutomations(),
    productLines: seedProductLines(),
    catalog: seedCatalog(),
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

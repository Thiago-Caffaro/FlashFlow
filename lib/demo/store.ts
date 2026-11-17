import type {
  AISession,
  AgentMemoryBlock,
  Account,
  AppNotification,
  AutomationWithSteps,
  CatalogProductOption,
  Conversation,
  ExternalFulfillmentLead,
  Flow,
  FlowMedia,
  FulfillmentOrder,
  FulfillmentProduct,
  LightfunnelsIntegration,
  LightfunnelsProduct,
  Message,
  MessageVariable,
  ProductLineWithProducts,
  SandboxContact,
  ShopifyAbandonedCheckout,
  ShopifyIntegration,
  ShopifyProduct,
  SlackChannel,
  SlackConnectionStatus,
  SlackNotificationSettings,
  Trigger,
} from '@/types'
import type { DeliveryStatusMapping } from '@/lib/fulfillment-delivery-status'
import type { SandboxRun } from './flow-runner'
import { DEMO_INSTANCE_ES, seedAccounts } from './seed/accounts'
import { seedAutomations, seedCatalog, seedProductLines } from './seed/automations'
import { seedAiSessions, seedChat, seedMessageVariables, seedNotifications } from './seed/conversations'
import { seedFlowMedia, seedFlows, seedTemplates, seedTriggers, type DemoTemplate } from './seed/flows'
import {
  seedAbandonedCheckouts,
  seedDeliveryMappings,
  seedExternalLeads,
  seedFenixIntegrations,
  seedFulfillmentProducts,
  seedLightfunnelsIntegrations,
  seedLightfunnelsProducts,
  seedOrders,
  seedShopifyIntegrations,
  seedShopifyProducts,
  type DemoFenixIntegration,
} from './seed/orders'
import {
  seedAiKeys,
  seedMemoryBlocks,
  seedSlackChannels,
  seedSlackSettings,
  seedSlackStatus,
  type DemoAiConfig,
} from './seed/settings'
import { seedSandboxContacts, seedSandboxFlows, seedSandboxTriggers } from './seed/sandbox'

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
  orders: FulfillmentOrder[]
  fulfillmentProducts: FulfillmentProduct[]
  shopifyProducts: ShopifyProduct[]
  lightfunnelsProducts: LightfunnelsProduct[]
  shopifyIntegrations: ShopifyIntegration[]
  lightfunnelsIntegrations: LightfunnelsIntegration[]
  fenixIntegrations: DemoFenixIntegration[]
  abandonedCheckouts: ShopifyAbandonedCheckout[]
  deliveryMappings: DeliveryStatusMapping[]
  externalLeads: ExternalFulfillmentLead[]
  settings: {
    shopifyTriggersEnabled: boolean
    lightfunnelsTriggersEnabled: boolean
    shopifyOrderInstanceName: string | null
  }
  memoryBlocks: AgentMemoryBlock[]
  aiKeys: ReturnType<typeof seedAiKeys>
  aiConfigs: Record<string, DemoAiConfig>
  slack: { status: SlackConnectionStatus; channels: SlackChannel[]; settings: SlackNotificationSettings[] }
  sandboxContacts: SandboxContact[]
  sandboxMessages: Message[]
  /** Fluxo em curso por conversa de teste. */
  sandboxRuns: Record<string, SandboxRun>
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
    flows: [...seedFlows(), ...seedSandboxFlows()],
    triggers: [...seedTriggers(), ...seedSandboxTriggers()],
    flowMedia: seedFlowMedia(),
    templates: seedTemplates(),
    automations: seedAutomations(),
    productLines: seedProductLines(),
    catalog: seedCatalog(),
    orders: seedOrders(),
    fulfillmentProducts: seedFulfillmentProducts(),
    shopifyProducts: seedShopifyProducts(),
    lightfunnelsProducts: seedLightfunnelsProducts(),
    shopifyIntegrations: seedShopifyIntegrations(),
    lightfunnelsIntegrations: seedLightfunnelsIntegrations(),
    fenixIntegrations: seedFenixIntegrations(),
    abandonedCheckouts: seedAbandonedCheckouts(),
    deliveryMappings: seedDeliveryMappings(),
    externalLeads: seedExternalLeads(),
    settings: { shopifyTriggersEnabled: true, lightfunnelsTriggersEnabled: true, shopifyOrderInstanceName: DEMO_INSTANCE_ES },
    memoryBlocks: seedMemoryBlocks(),
    aiKeys: seedAiKeys(),
    aiConfigs: {},
    slack: { status: seedSlackStatus(), channels: seedSlackChannels(), settings: seedSlackSettings() },
    sandboxContacts: seedSandboxContacts(),
    sandboxMessages: [],
    sandboxRuns: {},
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

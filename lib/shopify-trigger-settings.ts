import 'server-only'
import { getSetting, setSetting } from './app-settings'

export const SHOPIFY_TRIGGERS_ENABLED_KEY = 'shopify_triggers_enabled'

export async function getShopifyTriggersEnabled(): Promise<boolean> {
  const stored = await getSetting(SHOPIFY_TRIGGERS_ENABLED_KEY)
  return stored !== 'false'
}

export async function setShopifyTriggersEnabled(enabled: boolean): Promise<void> {
  await setSetting(SHOPIFY_TRIGGERS_ENABLED_KEY, enabled ? 'true' : 'false')
}

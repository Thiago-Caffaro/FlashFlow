import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { getShopifyTriggersEnabled } from './shopify-trigger-settings'
import type { OrderSource } from '@/types'

// Pausa global dos gatilhos de pedido Lightfunnels — independente da pausa
// da Shopify (lib/shopify-trigger-settings.ts).
export const LIGHTFUNNELS_TRIGGERS_ENABLED_KEY = 'lightfunnels_triggers_enabled'

export async function getLightfunnelsTriggersEnabled(): Promise<boolean> {
  const stored = await getSetting(LIGHTFUNNELS_TRIGGERS_ENABLED_KEY)
  return stored !== 'false'
}

export async function setLightfunnelsTriggersEnabled(enabled: boolean): Promise<void> {
  await setSetting(LIGHTFUNNELS_TRIGGERS_ENABLED_KEY, enabled ? 'true' : 'false')
}

export async function getOrderTriggersEnabled(source: OrderSource | null | undefined): Promise<boolean> {
  return source === 'lightfunnels' ? getLightfunnelsTriggersEnabled() : getShopifyTriggersEnabled()
}

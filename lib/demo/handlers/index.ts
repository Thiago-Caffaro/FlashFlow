import { registerAccountHandlers } from './accounts'
import { registerAuthHandlers } from './auth'
import { registerAutomationHandlers } from './automations'
import { registerChatHandlers } from './chat'
import { registerFlowHandlers } from './flows'

let registered = false

/** Regista todos os handlers da demo (idempotente). */
export function registerDemoHandlers(): void {
  if (registered) return
  registered = true
  registerAuthHandlers()
  registerAccountHandlers()
  registerChatHandlers()
  registerFlowHandlers()
  registerAutomationHandlers()
}

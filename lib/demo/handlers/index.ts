import { registerAccountHandlers } from './accounts'
import { registerAuthHandlers } from './auth'
import { registerChatHandlers } from './chat'

let registered = false

/** Regista todos os handlers da demo (idempotente). */
export function registerDemoHandlers(): void {
  if (registered) return
  registered = true
  registerAuthHandlers()
  registerAccountHandlers()
  registerChatHandlers()
}

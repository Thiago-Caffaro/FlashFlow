import { registerAccountHandlers } from './accounts'
import { registerAuthHandlers } from './auth'

let registered = false

/** Regista todos os handlers da demo (idempotente). */
export function registerDemoHandlers(): void {
  if (registered) return
  registered = true
  registerAuthHandlers()
  registerAccountHandlers()
}

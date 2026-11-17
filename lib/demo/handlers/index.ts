// Regista todos os handlers da demo. Cada módulo chama `route()` ao ser
// importado por `registerDemoHandlers`.
let registered = false

export function registerDemoHandlers(): void {
  if (registered) return
  registered = true
}

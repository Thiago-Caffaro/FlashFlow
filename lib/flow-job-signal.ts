// Sinal "há job novo na fila" dentro do mesmo processo. Fica em globalThis
// (como o flag de start do worker) porque no Next a instrumentation e as
// route handlers podem carregar cópias diferentes do mesmo módulo — um
// estado de módulo comum não seria visto pelos dois lados.
const globalSignal = globalThis as typeof globalThis & {
  __flashflowWakeFlowWorker?: () => void
}

export function registerFlowJobWorkerWake(wake: () => void): void {
  globalSignal.__flashflowWakeFlowWorker = wake
}

// Sem worker rodando neste processo (ex: testes, build), não faz nada — o
// job continua na fila durável e é pego pelo próximo poll.
export function wakeFlowJobWorker(): void {
  globalSignal.__flashflowWakeFlowWorker?.()
}

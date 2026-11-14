/**
 * Corre `work` marcando o estado "ocupado" e garante que ele é libertado no
 * fim, mesmo quando a requisição falha. Erros não são relançados: são
 * reportados via `onError`.
 */
export async function runBusy(
  setBusy: (busy: boolean) => void,
  work: () => Promise<void>,
  onError: (message: string) => void,
): Promise<void> {
  setBusy(true)
  try {
    await work()
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Erro inesperado')
  } finally {
    setBusy(false)
  }
}

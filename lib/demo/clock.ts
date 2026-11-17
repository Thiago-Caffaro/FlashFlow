export const nowIso = (): string => new Date().toISOString()

/** Data ISO `minutes` minutos antes de agora — mantém os dados de exemplo sempre recentes. */
export const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()

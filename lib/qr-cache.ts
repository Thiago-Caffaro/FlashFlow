// Cache in-memory de QR codes pendentes por instância.
// Suficiente para deployment single-container (Next.js standalone usa um processo único).
const cache = new Map<string, string>()

export function cacheQr(instanceName: string, qr: string) {
  cache.set(instanceName, qr)
  setTimeout(() => cache.delete(instanceName), 75_000)
}

export function getQr(instanceName: string): string | null {
  return cache.get(instanceName) ?? null
}

export function clearQr(instanceName: string) {
  cache.delete(instanceName)
}

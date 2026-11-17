import { blocked, ok, route } from '../router'

export function registerAccountHandlers(): void {
  // Mesmo formato de app/api/accounts/route.ts: sem `ok`, só `accounts`.
  route('GET', '/api/accounts', (_req, store) => ({ json: { accounts: store.accounts } }))

  route('GET', '/api/accounts/:name/status', (req, store) => {
    const account = store.accounts.find((a) => a.instanceName === req.params.name)
    if (!account) return { json: { state: 'close' } }
    return {
      json: {
        state: account.state,
        profileName: account.profileName ?? null,
        profilePicUrl: account.profilePicUrl ?? null,
        phone: account.phone ?? null,
      },
    }
  })

  route('GET', '/api/accounts/:name/qr', () => ({ json: { qr: null } }))

  // Ligar, desligar ou apagar contas exigiria um WhatsApp real.
  route('POST', '/api/accounts', () => blocked())
  route('POST', '/api/accounts/cloud-api', () => blocked())
  route('PATCH', '/api/accounts/:name', () => blocked())
  route('DELETE', '/api/accounts/:name', () => blocked())
  route('POST', '/api/accounts/:name/reconnect', () => blocked())

  // Sincronizações com o WhatsApp: nada a sincronizar.
  route('POST', '/api/sync', () => ok({ total: 0, synced: 0, failed: 0 }))
  route('POST', '/api/sync/initial', () => ok())
  route('POST', '/api/sync-contacts', () => ok({ updated: 0 }))
}

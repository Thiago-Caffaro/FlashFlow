import { ok, route } from '../router'

export function registerAuthHandlers(): void {
  // A demo não tem login: a sessão é sempre válida.
  route('GET', '/api/auth/verify', () => ok())
  route('POST', '/api/auth/login', () => ok())
  route('POST', '/api/auth/logout', () => ok())
}

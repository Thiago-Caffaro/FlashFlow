import 'server-only'
import { decryptSecret, encryptSecret } from './ai-crypto'

export const LIGHTFUNNELS_OAUTH_STATE_COOKIE = 'lightfunnels_oauth_state'

// Estado guardado no cookie entre /api/lightfunnels/auth e o callback,
// cifrado com a chave do servidor (AES-256-GCM).
export interface LightfunnelsOAuthState {
  nonce: string
  country: string
  name: string
}

export function encodeLightfunnelsOAuthState(state: LightfunnelsOAuthState): string {
  return JSON.stringify(encryptSecret(JSON.stringify(state)))
}

export function decodeLightfunnelsOAuthState(cookieValue: string): LightfunnelsOAuthState | null {
  try {
    const encrypted = JSON.parse(cookieValue) as { encrypted_key: string; iv: string; auth_tag: string }
    const parsed = JSON.parse(decryptSecret(encrypted.encrypted_key, encrypted.iv, encrypted.auth_tag)) as Partial<LightfunnelsOAuthState>
    if (typeof parsed.nonce !== 'string' || typeof parsed.country !== 'string') return null
    return { nonce: parsed.nonce, country: parsed.country, name: typeof parsed.name === 'string' ? parsed.name : '' }
  } catch {
    return null
  }
}

import 'server-only'
import { decryptSecret, encryptSecret } from './ai-crypto'

export const SHOPIFY_OAUTH_STATE_COOKIE = 'shopify_oauth_state'

// Estado guardado no cookie entre /api/shopify/auth e o callback, cifrado com
// a chave do servidor (AES-256-GCM). `app` só existe quando a loja está sendo
// conectada com um app próprio cujas credenciais ainda não foram salvas — o
// callback as grava junto com o token, depois de o OAuth dar certo.
export interface ShopifyOAuthState {
  nonce: string
  country: string
  app?: { clientId: string; clientSecret: string }
}

export function encodeShopifyOAuthState(state: ShopifyOAuthState): string {
  return JSON.stringify(encryptSecret(JSON.stringify(state)))
}

export function decodeShopifyOAuthState(cookieValue: string): ShopifyOAuthState | null {
  try {
    const encrypted = JSON.parse(cookieValue) as { encrypted_key: string; iv: string; auth_tag: string }
    const parsed = JSON.parse(decryptSecret(encrypted.encrypted_key, encrypted.iv, encrypted.auth_tag)) as Partial<ShopifyOAuthState>
    if (typeof parsed.nonce !== 'string' || typeof parsed.country !== 'string') return null
    const app = parsed.app
      && typeof parsed.app.clientId === 'string'
      && typeof parsed.app.clientSecret === 'string'
      ? { clientId: parsed.app.clientId, clientSecret: parsed.app.clientSecret }
      : undefined
    return { nonce: parsed.nonce, country: parsed.country, ...(app ? { app } : {}) }
  } catch {
    return null
  }
}

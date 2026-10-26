// Escopos que o FlashFlow precisa da loja. read_draft_orders cobre os
// rascunhos de apps de formulário COD (carrinho abandonado sem checkout).
export const REQUIRED_SHOPIFY_SCOPES = [
  'read_orders',
  'read_products',
  'read_checkouts',
  'read_inventory',
  'read_draft_orders',
] as const

export const DEFAULT_SHOPIFY_SCOPES = REQUIRED_SHOPIFY_SCOPES.join(',')

// Escopos configurados + os obrigatórios, sem repetir. Um valor salvo antes
// de um escopo novo existir (ex: read_draft_orders) não pode deixá-lo de fora.
export function withRequiredShopifyScopes(configured: string | null | undefined): string {
  const scopes = (configured ?? '').split(',').map((scope) => scope.trim()).filter(Boolean)
  for (const required of REQUIRED_SHOPIFY_SCOPES) {
    if (!scopes.includes(required)) scopes.push(required)
  }
  return scopes.join(',')
}

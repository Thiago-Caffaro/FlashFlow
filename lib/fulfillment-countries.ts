// Shopify sends ISO 3166-1 alpha-2 codes (e.g. "ES") in
// shipping_address.country_code / billing_address.country_code, but
// fulfillment_integrations, fulfillment_products and accounts.country all
// use FenixCOD's own full country names (e.g. "SPAIN") — confirmed against
// the country list FenixCOD's own login/connection check returns. Without
// this mapping, every Shopify order resolved its `country` to the raw
// 2-letter code, which never matches a configured fulfillment_integrations
// row, so nothing could ever be submitted to FenixCOD.
export const ISO_TO_FULFILLMENT_COUNTRY: Record<string, string> = {
  ES: 'SPAIN',
  PT: 'PORTUGAL',
  IT: 'ITALY',
  PL: 'POLAND',
  SK: 'ESLOVAKIA',
  CZ: 'CZECH REPUBLIC',
  RO: 'ROMANIA',
  BG: 'BULGARIA',
  GR: 'GREECE',
  HU: 'HUNGRY',
  SI: 'ESLOVENIA',
  HR: 'CROACIA',
  AT: 'AUSTRIA',
  DE: 'GERMANY',
  FR: 'FRANCE',
  BE: 'BELGIUM',
  NL: 'NETHERLANDS',
}

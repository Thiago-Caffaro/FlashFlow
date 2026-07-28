-- Backfill for orders/checkouts that already stored Shopify's raw ISO
-- 3166-1 alpha-2 country_code (e.g. "ES") instead of FenixCOD's full country
-- name (e.g. "SPAIN") — see lib/fulfillment-countries.ts and the fix to
-- normalizeCountry() in lib/shopify-confirmation-service.ts. Without this,
-- pre-existing Shopify-sourced orders can never be submitted to FenixCOD
-- (loadIntegration() looks up fulfillment_integrations by the full name) nor
-- get an automatic WhatsApp confirmation account assigned (assignConfirmationAccount()
-- looks up accounts by the full name too).
--
-- Only rows whose country is EXACTLY one of the known 2-letter codes are
-- touched; anything already stored as a full name (SPAIN, PORTUGAL, ...) is
-- left untouched. Countries FenixCOD doesn't operate in (e.g. "HK") have no
-- mapping and are intentionally left as-is — there is nothing to backfill
-- them to.

UPDATE fulfillment_orders SET country = 'SPAIN' WHERE country = 'ES';
UPDATE fulfillment_orders SET country = 'PORTUGAL' WHERE country = 'PT';
UPDATE fulfillment_orders SET country = 'ITALY' WHERE country = 'IT';
UPDATE fulfillment_orders SET country = 'POLAND' WHERE country = 'PL';
UPDATE fulfillment_orders SET country = 'ESLOVAKIA' WHERE country = 'SK';
UPDATE fulfillment_orders SET country = 'CZECH REPUBLIC' WHERE country = 'CZ';
UPDATE fulfillment_orders SET country = 'ROMANIA' WHERE country = 'RO';
UPDATE fulfillment_orders SET country = 'BULGARIA' WHERE country = 'BG';
UPDATE fulfillment_orders SET country = 'GREECE' WHERE country = 'GR';
UPDATE fulfillment_orders SET country = 'HUNGRY' WHERE country = 'HU';
UPDATE fulfillment_orders SET country = 'ESLOVENIA' WHERE country = 'SI';
UPDATE fulfillment_orders SET country = 'CROACIA' WHERE country = 'HR';
UPDATE fulfillment_orders SET country = 'AUSTRIA' WHERE country = 'AT';
UPDATE fulfillment_orders SET country = 'GERMANY' WHERE country = 'DE';
UPDATE fulfillment_orders SET country = 'FRANCE' WHERE country = 'FR';
UPDATE fulfillment_orders SET country = 'BELGIUM' WHERE country = 'BE';
UPDATE fulfillment_orders SET country = 'NETHERLANDS' WHERE country = 'NL';

UPDATE shopify_abandoned_checkouts SET country = 'SPAIN' WHERE country = 'ES';
UPDATE shopify_abandoned_checkouts SET country = 'PORTUGAL' WHERE country = 'PT';
UPDATE shopify_abandoned_checkouts SET country = 'ITALY' WHERE country = 'IT';
UPDATE shopify_abandoned_checkouts SET country = 'POLAND' WHERE country = 'PL';
UPDATE shopify_abandoned_checkouts SET country = 'ESLOVAKIA' WHERE country = 'SK';
UPDATE shopify_abandoned_checkouts SET country = 'CZECH REPUBLIC' WHERE country = 'CZ';
UPDATE shopify_abandoned_checkouts SET country = 'ROMANIA' WHERE country = 'RO';
UPDATE shopify_abandoned_checkouts SET country = 'BULGARIA' WHERE country = 'BG';
UPDATE shopify_abandoned_checkouts SET country = 'GREECE' WHERE country = 'GR';
UPDATE shopify_abandoned_checkouts SET country = 'HUNGRY' WHERE country = 'HU';
UPDATE shopify_abandoned_checkouts SET country = 'ESLOVENIA' WHERE country = 'SI';
UPDATE shopify_abandoned_checkouts SET country = 'CROACIA' WHERE country = 'HR';
UPDATE shopify_abandoned_checkouts SET country = 'AUSTRIA' WHERE country = 'AT';
UPDATE shopify_abandoned_checkouts SET country = 'GERMANY' WHERE country = 'DE';
UPDATE shopify_abandoned_checkouts SET country = 'FRANCE' WHERE country = 'FR';
UPDATE shopify_abandoned_checkouts SET country = 'BELGIUM' WHERE country = 'BE';
UPDATE shopify_abandoned_checkouts SET country = 'NETHERLANDS' WHERE country = 'NL';

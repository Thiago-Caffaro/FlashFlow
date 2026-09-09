-- 021_fulfillment_order_placed_at.sql
-- fulfillment_orders.created_at e' quando o FlashFlow criou o registro
-- (sincronizacao), nao necessariamente quando o pedido foi de fato feito
-- na Shopify -- se o webhook atrasar ou o pedido for importado depois,
-- os dois podem divergir. order_placed_at guarda a data/hora real do
-- pedido (Shopify: order.created_at do payload; pedidos manuais/de fluxo:
-- igual ao momento da criacao local, ja que nao ha um sistema externo com
-- data propria nesse caso).

ALTER TABLE fulfillment_orders ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMPTZ;

-- Backfill de pedidos existentes: sem uma data Shopify capturada
-- separadamente ate agora, created_at e' a melhor aproximacao disponivel.
UPDATE fulfillment_orders SET order_placed_at = created_at WHERE order_placed_at IS NULL;

ALTER TABLE fulfillment_orders ALTER COLUMN order_placed_at SET DEFAULT now();
ALTER TABLE fulfillment_orders ALTER COLUMN order_placed_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS fulfillment_orders_order_placed_at_idx ON fulfillment_orders (order_placed_at);

-- 028_shopify_draft_orders.sql
-- Rascunhos (draft orders) da Shopify como carrinho abandonado.
--
-- Apps de formulário COD criam o pedido como rascunho e só o convertem em
-- pedido quando o cliente confirma — nessas lojas não existe checkout da
-- Shopify, então os webhooks checkouts/* nunca chegam. Um rascunho que fica
-- aberto é o "carrinho abandonado" delas.
--
-- Rascunhos ficam na mesma tabela dos checkouts abandonados (mesmo gatilho,
-- mesmo tempo configurável, mesma recuperação), identificados por `source`.
-- shopify_checkout_id do rascunho é "draft:<id>" para nunca colidir com o id
-- de um checkout da mesma loja.

ALTER TABLE public.shopify_abandoned_checkouts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'checkout',
  ADD COLUMN IF NOT EXISTS shopify_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopify_abandoned_checkouts_source_check'
  ) THEN
    ALTER TABLE public.shopify_abandoned_checkouts
      ADD CONSTRAINT shopify_abandoned_checkouts_source_check
      CHECK (source IN ('checkout', 'draft_order'));
  END IF;
END $$;

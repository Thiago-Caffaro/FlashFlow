-- 026_shopify_multi_store.sql
-- Várias lojas Shopify, cada uma com o próprio app e as próprias contas
-- WhatsApp.
--
-- 1. App por loja: lojas de organizações diferentes não podem instalar o
--    mesmo app de distribuição personalizada, então cada loja pode guardar o
--    Client ID/Secret do seu app. Colunas vazias = usa o app global
--    (app_settings shopify_client_id/secret), como até agora.
-- 2. Contas WhatsApp por loja: pedidos e carrinhos de uma loja com contas
--    vinculadas vão para uma delas (preferindo a do país do pedido, depois a
--    prioridade). Loja sem vínculo segue a regra geral (conta padrão ou país).

ALTER TABLE public.shopify_integrations
  ADD COLUMN IF NOT EXISTS app_client_id text,
  ADD COLUMN IF NOT EXISTS encrypted_app_client_secret text,
  ADD COLUMN IF NOT EXISTS app_client_secret_iv text,
  ADD COLUMN IF NOT EXISTS app_client_secret_auth_tag text;

CREATE TABLE IF NOT EXISTS public.shopify_integration_accounts (
  integration_id uuid NOT NULL REFERENCES public.shopify_integrations(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, instance_name)
);

CREATE INDEX IF NOT EXISTS shopify_integration_accounts_instance_idx
  ON public.shopify_integration_accounts (instance_name);

ALTER TABLE public.shopify_integration_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shopify_integration_accounts FROM anon, authenticated;
GRANT ALL ON TABLE public.shopify_integration_accounts TO service_role;

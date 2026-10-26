-- 027_lightfunnels_integration.sql
-- Lightfunnels como segunda plataforma de e-commerce, lado a lado com a
-- Shopify. As colunas/tabelas shopify_* em produção não mudam: o Lightfunnels
-- ganha as suas, no mesmo padrão.
--
-- 1. lightfunnels_integrations: uma linha por conta Lightfunnels conectada via
--    OAuth (app de Partners global, credenciais em app_settings). O access
--    token expira em 2h e o refresh token é rotativo (cada refresh devolve um
--    novo e invalida o anterior) — ambos cifrados (AES-256-GCM, lib/ai-crypto).
-- 2. lightfunnels_integration_accounts: contas WhatsApp vinculadas a cada conta
--    Lightfunnels, como shopify_integration_accounts (026), mais funnel_ids:
--    vazio = todos os funis; preenchido = o vínculo só recebe pedidos desses
--    funis.
-- 3. lightfunnels_products: catálogo sincronizado (espelho de shopify_products).
-- 4. fulfillment_orders: source 'lightfunnels' + colunas lightfunnels_*.
-- 5. flow_jobs: job 'lightfunnels_order_flow' (gatilho "Pedido Lightfunnels").

CREATE TABLE IF NOT EXISTS public.lightfunnels_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lf_account_id text NOT NULL UNIQUE,
  encrypted_access_token text NOT NULL,
  access_token_iv text NOT NULL,
  access_token_auth_tag text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  encrypted_refresh_token text NOT NULL,
  refresh_token_iv text NOT NULL,
  refresh_token_auth_tag text NOT NULL,
  scopes text NOT NULL DEFAULT '',
  default_country text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  oauth_connected boolean NOT NULL DEFAULT true,
  -- Escrita de volta no Lightfunnels (tags ff:* nos pedidos). Opt-in.
  writeback_enabled boolean NOT NULL DEFAULT false,
  -- IDs dos webhooks criados via createWebhook, por tipo de evento.
  webhook_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_webhook_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lightfunnels_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightfunnels_integrations FROM anon, authenticated;
GRANT ALL ON TABLE public.lightfunnels_integrations TO service_role;

CREATE TABLE IF NOT EXISTS public.lightfunnels_integration_accounts (
  integration_id uuid NOT NULL REFERENCES public.lightfunnels_integrations(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  funnel_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, instance_name)
);

CREATE INDEX IF NOT EXISTS lightfunnels_integration_accounts_instance_idx
  ON public.lightfunnels_integration_accounts (instance_name);

ALTER TABLE public.lightfunnels_integration_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightfunnels_integration_accounts FROM anon, authenticated;
GRANT ALL ON TABLE public.lightfunnels_integration_accounts TO service_role;

CREATE TABLE IF NOT EXISTS public.lightfunnels_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lightfunnels_integration_id uuid REFERENCES public.lightfunnels_integrations(id) ON DELETE SET NULL,
  lf_product_id text,
  lf_variant_id text,
  sku text,
  title text NOT NULL,
  variant_title text,
  units_per_pack integer NOT NULL DEFAULT 1 CHECK (units_per_pack BETWEEN 1 AND 1000),
  price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  image_url text,
  hidden boolean NOT NULL DEFAULT false,
  keep_local_copy boolean NOT NULL DEFAULT false,
  local_product_id uuid REFERENCES public.fulfillment_products(id) ON DELETE SET NULL,
  raw_lightfunnels_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Não parcial de propósito: é o alvo do upsert do sync (ver 006).
CREATE UNIQUE INDEX IF NOT EXISTS lightfunnels_products_variant_unique_idx
  ON public.lightfunnels_products (lightfunnels_integration_id, lf_variant_id);

CREATE INDEX IF NOT EXISTS lightfunnels_products_integration_idx
  ON public.lightfunnels_products (lightfunnels_integration_id, hidden);

ALTER TABLE public.lightfunnels_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightfunnels_products FROM anon, authenticated;
GRANT ALL ON TABLE public.lightfunnels_products TO service_role;

ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS lightfunnels_integration_id uuid
    REFERENCES public.lightfunnels_integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lightfunnels_order_id text,
  ADD COLUMN IF NOT EXISTS lightfunnels_order_name text,
  ADD COLUMN IF NOT EXISTS lightfunnels_funnel_id text,
  ADD COLUMN IF NOT EXISTS lightfunnels_store_id text,
  ADD COLUMN IF NOT EXISTS lightfunnels_financial_status text,
  ADD COLUMN IF NOT EXISTS lightfunnels_fulfillment_status text,
  ADD COLUMN IF NOT EXISTS lightfunnels_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS lightfunnels_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_lightfunnels_payload jsonb,
  ADD COLUMN IF NOT EXISTS lightfunnels_writeback_tags text[],
  ADD COLUMN IF NOT EXISTS lightfunnels_writeback_error text;

ALTER TABLE public.fulfillment_orders
  DROP CONSTRAINT IF EXISTS fulfillment_orders_source_check;
ALTER TABLE public.fulfillment_orders
  ADD CONSTRAINT fulfillment_orders_source_check
  CHECK (source IN ('manual', 'shopify', 'lightfunnels'));

CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_orders_lightfunnels_unique_idx
  ON public.fulfillment_orders (lightfunnels_integration_id, lightfunnels_order_id)
  WHERE lightfunnels_integration_id IS NOT NULL AND lightfunnels_order_id IS NOT NULL;

ALTER TABLE public.flow_jobs
  DROP CONSTRAINT IF EXISTS flow_jobs_job_type_check;
ALTER TABLE public.flow_jobs
  ADD CONSTRAINT flow_jobs_job_type_check
  CHECK (job_type IN (
    'shopify_order_flow',
    'flow_message_resume',
    'delivery_status_flow',
    'abandoned_checkout_flow',
    'lightfunnels_order_flow'
  ));

-- Consolidated migration for the codex/fulfillment-integration branch.
-- Applies on top of the main-branch schema (notifications_migration.sql,
-- tools_support_migration.sql and everything before them already applied).
-- Run this once against the dev Supabase project to bring it level with
-- this branch. NOT yet applied to production.
--
-- Replaces, in order: fulfillment_migration.sql, shopify_confirmation_migration.sql,
-- shopify_templates_migration.sql, shopify_oauth_migration.sql

-- ─── European Fulfilment integration ───────────────────────────────────────

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE TABLE IF NOT EXISTS fulfillment_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('test', 'production')),
  encrypted_email TEXT NOT NULL,
  email_iv TEXT NOT NULL,
  email_auth_tag TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  password_auth_tag TEXT NOT NULL,
  encrypted_token TEXT,
  token_iv TEXT,
  token_auth_tag TEXT,
  token_expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fulfillment_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country, sku)
);

CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  lead_number TEXT UNIQUE,
  instance_name TEXT NOT NULL,
  country TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  zipcode TEXT NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('COD', 'PREPAID')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending_operator',
  external_snapshot JSONB,
  last_error TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fulfillment_orders_conversation_idx
  ON fulfillment_orders(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fulfillment_orders_instance_idx
  ON fulfillment_orders(instance_name, created_at DESC);

CREATE TABLE IF NOT EXISTS fulfillment_order_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_name TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_name, remote_jid)
);

-- ─── Shopify confirmation and Fenix COD handoff ────────────────────────────

CREATE TABLE IF NOT EXISTS shopify_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  shop_domain TEXT NOT NULL UNIQUE,
  encrypted_admin_token TEXT NOT NULL,
  admin_token_iv TEXT NOT NULL,
  admin_token_auth_tag TEXT NOT NULL,
  encrypted_webhook_secret TEXT,
  webhook_secret_iv TEXT,
  webhook_secret_auth_tag TEXT,
  default_country TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  oauth_connected BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_message_template TEXT,
  recovery_message_template TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS confirmation_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS confirmation_priority INTEGER NOT NULL DEFAULT 100;

ALTER TABLE fulfillment_orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS shopify_integration_id UUID REFERENCES shopify_integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shopify_order_id TEXT,
  ADD COLUMN IF NOT EXISTS shopify_order_name TEXT,
  ADD COLUMN IF NOT EXISTS shopify_order_number TEXT,
  ADD COLUMN IF NOT EXISTS raw_shopify_payload JSONB,
  ADD COLUMN IF NOT EXISTS commercial_status TEXT NOT NULL DEFAULT 'Não responde',
  ADD COLUMN IF NOT EXISTS send_status TEXT NOT NULL DEFAULT 'Pendente',
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'Não enviado',
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_message_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_message_error TEXT,
  ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS simulation_marker TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_orders_source_check'
  ) THEN
    ALTER TABLE fulfillment_orders
      ADD CONSTRAINT fulfillment_orders_source_check
        CHECK (source IN ('manual', 'shopify'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_orders_commercial_status_check'
  ) THEN
    ALTER TABLE fulfillment_orders
      ADD CONSTRAINT fulfillment_orders_commercial_status_check
        CHECK (commercial_status IN (
          'Confirmado WhatsApp',
          'Confirmado Call',
          'Confirmado Upsell Call',
          'Confirmado Upsell WhatsApp',
          'Confirmado',
          'Desistiu',
          'Não responde'
        ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_orders_send_status_check'
  ) THEN
    ALTER TABLE fulfillment_orders
      ADD CONSTRAINT fulfillment_orders_send_status_check
        CHECK (send_status IN ('Pendente', 'Enviado', 'Não enviar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_orders_delivery_status_check'
  ) THEN
    ALTER TABLE fulfillment_orders
      ADD CONSTRAINT fulfillment_orders_delivery_status_check
        CHECK (delivery_status IN (
          'Não enviado',
          'Enviado',
          'A caminho',
          'Novidade',
          'Rejeitado',
          'Entregue'
        ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_orders_shopify_unique_idx
  ON fulfillment_orders(shopify_integration_id, shopify_order_id)
  WHERE source = 'shopify' AND shopify_order_id IS NOT NULL AND shopify_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fulfillment_orders_confirmation_queue_idx
  ON fulfillment_orders(commercial_status, send_status, delivery_status, created_at DESC);

CREATE TABLE IF NOT EXISTS shopify_abandoned_checkouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_integration_id UUID REFERENCES shopify_integrations(id) ON DELETE SET NULL,
  shopify_checkout_id TEXT,
  checkout_token TEXT,
  shop_domain TEXT NOT NULL,
  assigned_instance_name TEXT,
  country TEXT NOT NULL,
  contact_phone TEXT,
  customer_name TEXT,
  email TEXT,
  abandoned_checkout_url TEXT,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  recovery_status TEXT NOT NULL DEFAULT 'Pendente'
    CHECK (recovery_status IN ('Pendente', 'Enviado', 'Não enviar', 'Convertido')),
  raw_shopify_payload JSONB,
  whatsapp_sent_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  last_error TEXT,
  is_simulation BOOLEAN NOT NULL DEFAULT false,
  simulation_marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopify_abandoned_checkouts_unique_idx
  ON shopify_abandoned_checkouts(shopify_integration_id, shopify_checkout_id)
  WHERE shopify_checkout_id IS NOT NULL AND shopify_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shopify_abandoned_checkouts_queue_idx
  ON shopify_abandoned_checkouts(recovery_status, created_at DESC);

-- ─── Shopify OAuth + app-wide encrypted settings ───────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  value_iv TEXT NOT NULL,
  value_auth_tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

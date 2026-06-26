-- Shopify confirmation and Fenix COD handoff

CREATE TABLE IF NOT EXISTS shopify_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  shop_domain TEXT NOT NULL UNIQUE,
  encrypted_admin_token TEXT NOT NULL,
  admin_token_iv TEXT NOT NULL,
  admin_token_auth_tag TEXT NOT NULL,
  encrypted_webhook_secret TEXT NOT NULL,
  webhook_secret_iv TEXT NOT NULL,
  webhook_secret_auth_tag TEXT NOT NULL,
  default_country TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
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
